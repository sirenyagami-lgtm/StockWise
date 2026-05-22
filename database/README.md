# StockWise Database Files

Use these files for future database setup instead of the old phase-by-phase SQL files in `database/legacy/`.

## For a clean database
Import:

1. `database/stockwise_schema_full.sql`

This creates the current StockWise database structure without sample sales data.

## For an existing old database
Import:

1. `database/migrations/upgrade_existing_stockwise.sql`

This safely adds the current columns/tables for roles, store workspace, onboarding, notifications, data format settings, employee status, and generated results.

## Legacy files
Old phase SQL files are kept in `database/legacy/` only for reference. Avoid importing them one-by-one unless you know exactly which old phase you are restoring.
