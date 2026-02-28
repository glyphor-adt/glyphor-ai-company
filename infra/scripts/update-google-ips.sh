#!/bin/bash

# update-google-ips.sh
# 
# Fetches Google IP ranges and outputs them in a format suitable for
# Vercel WAF/Trusted IPs configuration.
#
# Usage:
#   ./update-google-ips.sh [output-format]
#
# Arguments:
#   output-format: json|cidr|terraform (default: cidr)
#
# Examples:
#   ./update-google-ips.sh cidr > google-ips.txt
#   ./update-google-ips.sh json > google-ips.json
#   ./update-google-ips.sh terraform > google-ips.tf

set -euo pipefail

# Configuration
GOOGLE_IP_URL="https://www.gstatic.com/ipranges/goog.json"
OUTPUT_FORMAT="${1:-cidr}"
TEMP_FILE=$(mktemp)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1" >&2
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1" >&2
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

# Cleanup on exit
cleanup() {
    rm -f "$TEMP_FILE"
}
trap cleanup EXIT

# Fetch Google IP ranges
log_info "Fetching Google IP ranges from $GOOGLE_IP_URL"
if ! curl -s -f -o "$TEMP_FILE" "$GOOGLE_IP_URL"; then
    log_error "Failed to fetch Google IP ranges"
    exit 1
fi

# Validate JSON
if ! jq empty "$TEMP_FILE" 2>/dev/null; then
    log_error "Invalid JSON received from Google"
    exit 1
fi

# Extract IPv4 and IPv6 prefixes
log_info "Parsing IP ranges..."
IPV4_RANGES=$(jq -r '.prefixes[]?.ipv4Prefix // empty' "$TEMP_FILE" | sort -u)
IPV6_RANGES=$(jq -r '.prefixes[]?.ipv6Prefix // empty' "$TEMP_FILE" | sort -u)

IPV4_COUNT=$(echo "$IPV4_RANGES" | wc -l | tr -d ' ')
IPV6_COUNT=$(echo "$IPV6_RANGES" | wc -l | tr -d ' ')

log_info "Found $IPV4_COUNT IPv4 ranges and $IPV6_COUNT IPv6 ranges"

# Output based on format
case "$OUTPUT_FORMAT" in
    cidr)
        log_info "Outputting CIDR format (one per line)"
        echo "# Google IP Ranges (IPv4)"
        echo "# Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
        echo "# Source: $GOOGLE_IP_URL"
        echo ""
        echo "$IPV4_RANGES"
        echo ""
        echo "# Google IP Ranges (IPv6)"
        echo "$IPV6_RANGES"
        ;;
    
    json)
        log_info "Outputting JSON format"
        jq -n \
            --arg generated "$(date -u +"%Y-%m-%d %H:%M:%S UTC")" \
            --arg source "$GOOGLE_IP_URL" \
            --argjson ipv4 "$(echo "$IPV4_RANGES" | jq -R -s -c 'split("\n") | map(select(length > 0))')" \
            --argjson ipv6 "$(echo "$IPV6_RANGES" | jq -R -s -c 'split("\n") | map(select(length > 0))')" \
            '{
                generated: $generated,
                source: $source,
                ipv4_ranges: $ipv4,
                ipv6_ranges: $ipv6,
                total_ranges: ($ipv4 | length) + ($ipv6 | length)
            }'
        ;;
    
    terraform)
        log_info "Outputting Terraform format"
        echo "# Google IP Ranges for Vercel WAF"
        echo "# Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
        echo "# Source: $GOOGLE_IP_URL"
        echo ""
        echo "locals {"
        echo "  google_ipv4_ranges = ["
        echo "$IPV4_RANGES" | sed 's/^/    "/' | sed 's/$/",/'
        echo "  ]"
        echo ""
        echo "  google_ipv6_ranges = ["
        echo "$IPV6_RANGES" | sed 's/^/    "/' | sed 's/$/",/'
        echo "  ]"
        echo ""
        echo "  all_google_ranges = concat("
        echo "    local.google_ipv4_ranges,"
        echo "    local.google_ipv6_ranges"
        echo "  )"
        echo "}"
        ;;
    
    vercel-api)
        log_info "Outputting Vercel API payload format"
        # This would be used with Vercel API to update trusted IPs
        jq -n \
            --argjson ipv4 "$(echo "$IPV4_RANGES" | jq -R -s -c 'split("\n") | map(select(length > 0))')" \
            '{
                trustedIps: $ipv4 | map({
                    value: .,
                    note: "Google PageSpeed Insights"
                })
            }'
        ;;
    
    *)
        log_error "Unknown output format: $OUTPUT_FORMAT"
        log_error "Supported formats: cidr, json, terraform, vercel-api"
        exit 1
        ;;
esac

log_info "Done!"
