---
name: sharepoint-site-management
slug: sharepoint-site-management
category: operations
description: Create, design, and manage SharePoint Online sites - communication sites, team sites, site pages, navigation, web parts, themes, and branding. Use when a directive requires a new SharePoint site (intranet, department hub, project site, knowledge base), when an existing site needs redesign or new pages, when marketing needs a branded internal communications hub, or when any SharePoint content needs creating or updating programmatically.
holders: m365-admin, cmo
tools_granted: spo_create_site, spo_delete_site, spo_get_site_status, spo_create_site_page, spo_update_site_page, spo_publish_page, spo_get_pages, spo_delete_page, spo_create_site_script, spo_get_site_scripts, spo_create_site_design, spo_get_site_designs, spo_apply_site_design, spo_get_site_script_from_web, spo_set_site_branding, spo_update_navigation, spo_create_list, spo_get_lists, spo_update_list, spo_add_list_item, spo_get_list_items, upload_to_sharepoint, web_search, save_memory, send_agent_message
version: 1
---

# SharePoint Site Management

You manage the company's SharePoint Online presence. This includes creating new sites, designing page layouts, managing content, and ensuring every site reflects professional quality - whether it's an internal intranet, a department hub, a project workspace, or a marketing communications center.

SharePoint has two API surfaces you'll use:
- **SharePoint REST API** (`_api/`) - site creation, site designs/scripts, branding, lists, classic operations
- **Microsoft Graph API** (`graph.microsoft.com`) - modern site pages, web parts, publishing, newer operations

Different operations use different APIs. The tools abstract this - you call the tool, it routes to the correct API.

---

## What You Can Build

| Site type | Template | When to use |
|-----------|---------|-------------|
| **Communication site** | `SITEPAGEPUBLISHING#0` | Company announcements, marketing hub, knowledge base, landing pages for internal audiences |
| **Team site** (no M365 Group) | `STS#3` | Project workspaces, department hubs, document collaboration - when you don't need a full Teams channel |
| **Team site** (with M365 Group) | Created via Groups API | When the site needs a connected Teams channel, shared mailbox, and Planner |

---

## Creating a New Site

### Step 1: Determine the site type

Ask: "Does this site need a Teams channel, shared mailbox, and group calendar?"
- **Yes** -> Create an M365 Group (which auto-creates a team site). Use Riley's Entra tools.
- **No, it's for publishing/communication** -> Communication site via `spo_create_site`
- **No, it's for a team workspace without full M365 group** -> Team site via `spo_create_site`

### Step 2: Create the site

```js
spo_create_site({
  title: "Marketing Hub",
  url: "https://glyphor.sharepoint.com/sites/marketing-hub",
  template: "SITEPAGEPUBLISHING#0",   // Communication site
  description: "Central hub for marketing team communications and campaigns",
  owner: "maya@glyphor.com",
  lcid: 1033,                          // English
  site_design_id: "96c933ac-3698-44c7-9f4a-5fd17d71af9e"  // Standard design (or custom)
})
```

**Built-in site design IDs:**
- Standard communication: `96c933ac-3698-44c7-9f4a-5fd17d71af9e`
- Showcase: `6142d2a0-63a5-4ba0-aede-d9fefca2c767`
- Blank: `f6cc5403-0d63-442e-96c0-285923709ffc`

### Step 3: Verify creation

```js
spo_get_site_status({ url: "https://glyphor.sharepoint.com/sites/marketing-hub" })
```

Status values: 0 = Not Found, 1 = Provisioning, 2 = Ready, 3 = Error, 4 = URL already exists.

Poll until status is 2 (Ready) before proceeding.

---

## Designing a Site (Themes, Branding, Scripts)

### Site scripts: Reusable design blueprints

A site script is a JSON definition of actions to apply to a site - themes, lists, navigation, branding. Create once, apply to any site.

**Example: Create a branded site script**

```js
spo_create_site_script({
  title: "Glyphor Brand Script",
  content: {
    "$schema": "schema.json",
    "actions": [
      {
        "verb": "applyTheme",
        "themeName": "Glyphor Dark"
      },
      {
        "verb": "setSiteBranding",
        "navigationLayout": "Cascade",
        "headerLayout": "Compact",
        "headerBackground": "None",
        "showFooter": true
      },
      {
        "verb": "createSPList",
        "listName": "Announcements",
        "templateType": 104
      },
      {
        "verb": "addNavLink",
        "url": "/sites/marketing-hub/SitePages/Home.aspx",
        "displayName": "Home",
        "isWebRelative": true
      }
    ],
    "version": 1
  }
})
```

**Available script actions:**
- `applyTheme` - apply a registered theme
- `setSiteBranding` - navigation layout, header, footer
- `createSPList` - create a list or library
- `addSPView` - add a view to a list
- `addNavLink` - add navigation links
- `removeNavLink` - remove navigation links
- `setSiteExternalSharingCapability` - control external sharing
- `setRegionalSettings` - timezone, locale, date format
- `addPrincipalToSPGroup` - add users to SharePoint groups
- `setSiteLogo` - set the site logo
- `joinHubSite` - join to a hub site
- `triggerFlow` - trigger a Power Automate flow
- `installSolution` - install an SPFx solution

### Site designs: Combine scripts into a named design

```js
spo_create_site_design({
  title: "Glyphor Communication Site",
  description: "Standard branding for all Glyphor communication sites",
  site_script_ids: ["<script_id_from_above>"],
  template: "SITEPAGEPUBLISHING#0"  // communication site
})
```

### Apply a design to an existing site

```js
spo_apply_site_design({
  site_url: "https://glyphor.sharepoint.com/sites/marketing-hub",
  site_design_id: "<design_id>"
})
```

### Extract design from an existing site

If you have a site that looks right and want to replicate its setup:

```js
spo_get_site_script_from_web({
  url: "https://glyphor.sharepoint.com/sites/existing-good-site",
  include_branding: true,
  include_theme: true,
  include_regional_settings: true,
  include_links: true,
  included_lists: ["Lists/Announcements"]
})
```

This returns the site script JSON that reproduces the site's configuration. Save it as a reusable script.

---

## Creating and Managing Site Pages

Site pages are the content layer - the actual pages people see. Use the Microsoft Graph-based tools for modern page creation.

### Create a new page

```js
spo_create_site_page({
  site_url: "https://glyphor.sharepoint.com/sites/marketing-hub",
  name: "q1-campaign-update.aspx",
  title: "Q1 Campaign Update",
  page_layout: "article",    // article | home | singleWebPartAppPage
  show_comments: true,
  title_area: {
    layout: "colorBlock",     // plain | imageAndTitle | colorBlock | overlap
    text_alignment: "left",
    show_author: true,
    show_published_date: true,
    text_above_title: "MARKETING UPDATE"
  },
  canvas_layout: {
    horizontal_sections: [
      {
        layout: "oneColumn",
        columns: [
          {
            width: 12,
            webparts: [
              {
                type: "text",
                inner_html: "<h2>Campaign Performance</h2><p>Our Q1 campaign reached...</p>"
              }
            ]
          }
        ]
      },
      {
        layout: "twoColumn",
        columns: [
          {
            width: 6,
            webparts: [
              {
                type: "text",
                inner_html: "<h3>Email Results</h3><p>Open rate: 34%. Click-through: 8.2%.</p>"
              }
            ]
          },
          {
            width: 6,
            webparts: [
              {
                type: "text",
                inner_html: "<h3>Social Results</h3><p>LinkedIn impressions: 45K. Engagement: 6.1%.</p>"
              }
            ]
          }
        ]
      }
    ]
  }
})
```

**Page layouts:**
- `article` - standard content page with title area
- `home` - site home page layout
- `singleWebPartAppPage` - full-page app (single SPFx web part)

**Title area layouts:**
- `plain` - text only, no image
- `imageAndTitle` - title with background image
- `colorBlock` - colored background with title
- `overlap` - title overlapping an image

**Section layouts:**
- `oneColumn` - full width
- `twoColumn` - 50/50 split
- `threeColumn` - 33/33/33 split
- `oneThirdLeftColumn` - narrow left (4), wide right (8)
- `oneThirdRightColumn` - wide left (8), narrow right (4)

**Supported web parts for page creation via API:**
- Text (`innerHtml`)
- Image
- Hero
- Quick Links
- Markdown
- People
- News
- Events
- Call to Action
- Divider
- Spacer

### Publish a page

Pages are created as drafts. You must explicitly publish:

```js
spo_publish_page({
  site_url: "https://glyphor.sharepoint.com/sites/marketing-hub",
  page_name: "q1-campaign-update.aspx"
})
```

### Promote a page to news

After publishing, promote to news so it appears in news feeds:

```js
spo_update_site_page({
  site_url: "https://glyphor.sharepoint.com/sites/marketing-hub",
  page_id: "<page_id>",
  promote_as_news: true
})
```

### Update an existing page

```js
spo_update_site_page({
  site_url: "https://glyphor.sharepoint.com/sites/marketing-hub",
  page_id: "<page_id>",
  title: "Updated Q1 Campaign Results",
  canvas_layout: { ... }  // new layout replaces existing
})
```

---

## Managing Lists and Libraries

Lists are the data layer of SharePoint - announcements, events, contacts, custom data.

### Create a list

```js
spo_create_list({
  site_url: "https://glyphor.sharepoint.com/sites/marketing-hub",
  title: "Campaign Tracker",
  template_type: 100,   // 100 = custom list, 104 = announcements, 106 = events
  description: "Track active marketing campaigns and their status"
})
```

**Common template types:**
- 100 - Custom list (most flexible)
- 101 - Document library
- 104 - Announcements
- 106 - Events/Calendar
- 107 - Tasks

### Add items to a list

```js
spo_add_list_item({
  site_url: "https://glyphor.sharepoint.com/sites/marketing-hub",
  list_title: "Campaign Tracker",
  fields: {
    "Title": "Q1 LinkedIn Campaign",
    "Status": "Active",
    "StartDate": "2026-01-15",
    "Owner": "Maya Brooks"
  }
})
```

---

## Managing Navigation

### Update site navigation

```js
spo_update_navigation({
  site_url: "https://glyphor.sharepoint.com/sites/marketing-hub",
  navigation_type: "quickLaunch",   // quickLaunch | topNavigation
  nodes: [
    { title: "Home", url: "/sites/marketing-hub/SitePages/Home.aspx" },
    { title: "Campaigns", url: "/sites/marketing-hub/Lists/Campaign Tracker" },
    { title: "Brand Assets", url: "/sites/marketing-hub/Shared Documents" },
    { title: "Team", url: "/sites/marketing-hub/SitePages/Team.aspx" }
  ]
})
```

---

## Common Workflows

### Riley: Create a new department intranet site

```text
1. spo_create_site (communication site, blank design)
2. spo_create_site_script (custom brand script with theme + nav + lists)
3. spo_apply_site_design (apply the brand script)
4. spo_create_site_page (home page with hero, news, quick links)
5. spo_publish_page
6. spo_create_list (announcements, events, documents)
7. spo_update_navigation
8. Send the site URL to the requesting team
```

### Maya: Create a marketing campaign hub page

```text
1. spo_create_site_page (article layout with campaign content)
2. Add sections: hero image, campaign metrics, social results, next steps
3. spo_publish_page
4. spo_update_site_page (promote as news for org-wide visibility)
5. Update navigation to include the new page
```

### Maya: Redesign an existing site's branding

```text
1. spo_get_site_script_from_web (extract current design as baseline)
2. Modify the script: update theme, navigation layout, header style
3. spo_create_site_script (save the new design)
4. spo_apply_site_design (apply to the site)
5. Verify the site looks right - adjust and reapply if needed
```

---

## Credential Requirements

### What's needed on the Entra app registration

The Agent365 MCP or the Glyphor scheduler's app registration needs these Microsoft Graph / SharePoint permissions:

| Permission | Type | What it enables |
|-----------|------|----------------|
| `Sites.FullControl.All` | Application | Create, read, update, delete sites and all content |
| `Sites.Manage.All` | Application | Create and manage sites (lighter than FullControl) |
| `Sites.ReadWrite.All` | Application | Read/write site content, lists, pages |

For SharePoint REST API specifically (site creation, site designs):
| Permission | Type | What it enables |
|-----------|------|----------------|
| SharePoint Admin role | Delegated | Create sites, manage site designs |
| `AllSites.FullControl` | Application (SharePoint-specific) | Full control of all site collections |

**Current gap:** Check which scopes the `mcp_ODSPRemoteServer` app registration currently has. It likely has file/document permissions but NOT site creation permissions.

**Action for Riley:**
1. Go to Azure Portal -> App registrations -> find the Agent365 / ODSP app
2. Add `Sites.FullControl.All` or `Sites.Manage.All` application permission
3. Grant admin consent
4. Verify the app can call `_api/SPSiteManager/create`

### Also enable the disabled MCP

`mcp_SharePointLists` is currently disabled in the taxonomy. Enable it - the list management tools live there.

---

## Quality Standards for SharePoint Sites

### Every site must have:
- A branded theme applied (not default blue)
- Custom navigation reflecting the site's purpose (not default links)
- A designed home page (not the default blank page)
- Proper permissions set (not everyone-can-edit)
- At least one content page published

### Every page must have:
- A title area with layout (not plain unless intentional)
- Structured sections (not one giant text block)
- Published status (drafts are invisible to visitors)
- Mobile-responsive layout (use standard section layouts, not custom HTML)

### Don't:
- Create sites with default branding and no customization
- Leave navigation as default placeholder links
- Create pages without publishing them
- Use custom HTML/CSS in text web parts (breaks responsive design)
- Create document libraries without folder structure or metadata columns