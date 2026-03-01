# Smoketest Package Setup Instructions

## Quick Start

Due to PowerShell 6+ not being available on this system, I've created automated setup scripts for you.

### Option 1: Automated Setup (Recommended)

Simply run the complete setup script:

```cmd
CREATE_SMOKETEST_COMPLETE.bat
```

This will:
1. Create all necessary directories
2. Generate all package files with proper content
3. Show you the next steps

### Option 2: Manual Steps

If you prefer to do it manually or the automated script doesn't work:

1. **Create directories:**
   ```cmd
   SETUP_DIRS.bat
   ```

2. **Create files:**
   ```cmd
   node setup_smoketest_files.js
   ```

## What Gets Created

```
packages/smoketest/
├── package.json           # Package configuration with dependencies
├── tsconfig.json         # TypeScript configuration
├── README.md             # Package documentation
└── src/
    ├── types.ts          # TypeScript type definitions
    ├── layers/           # (empty, ready for test layer files)
    └── utils/
        ├── http-client.ts    # HTTP utility for API testing
        ├── sql-client.ts     # SQL/Supabase utility
        └── gcp-client.ts     # Google Cloud Platform utility
```

## After Setup

Once the files are created, complete the setup:

```cmd
cd packages\smoketest
npm install
npm run build
```

## Verification

To verify the package is set up correctly:

```cmd
cd packages\smoketest
npm run typecheck
```

## Files Created

All helper scripts have been placed in the repository root:
- `CREATE_SMOKETEST_COMPLETE.bat` - One-command complete setup
- `SETUP_DIRS.bat` - Directory creation only
- `setup_smoketest_files.js` - File creation with content
- `SMOKETEST_SETUP_INSTRUCTIONS.md` - This file

## Troubleshooting

If you encounter any issues:

1. Make sure you're running from the repository root
2. Ensure Node.js is installed and accessible
3. Check that you have write permissions to the packages directory

## Next Steps

After successful setup, you can:
1. Add test layer implementations in `src/layers/`
2. Create a CLI entry point in `src/cli.ts`
3. Add test execution logic in `src/index.ts`
4. Configure the smoketest settings via `.smoketestrc.json`
