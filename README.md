# MailFlow Desktop

A license-based email sending desktop application built with Electron, Node.js, Express, and SQLite.

## Features

- **Campaign Management**: Create, edit, and manage email campaigns with rotation support
- **SMTP Configuration**: Connect multiple SMTP servers
- **Bulk Sending**: Send to large recipient lists with real-time SSE progress tracking
- **Inbox Finder**: Test email deliverability across sender/domain combinations
- **Template Library**: HTML email templates and attachments
- **Proxy Support**: HTTP, HTTPS, and SOCKS proxy configuration
- **License Gated**: Requires a valid license key to use

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Run as Web Server (Development)

```bash
npm start
```

Opens at `http://localhost:3000`

### 3. Run as Electron App

```bash
npm run electron:dev
```

### 4. Build Installer (Windows)

```bash
npm run electron:build
```

Produces an NSIS installer in the `dist/` folder.

## Project Structure

```
electron/
  main.cjs          # Electron main process
  preload.js         # Context bridge for IPC
server.mjs           # Express server entry point
database/
  db.mjs             # Database operations
  schema.sql         # SQLite schema
middleware/
  auth.mjs           # Auth middleware (single-user passthrough)
routes/
  auth.mjs           # User profile routes
  user.mjs           # User API (SMTP, campaigns, settings)
  send.mjs           # Email sending with SSE progress
  inbox-finder.mjs   # Deliverability testing
  upload.mjs         # Image uploads
  license.mjs        # License activation/status
services/
  email-sender.mjs   # Core email sending engine
  encryption.mjs     # SMTP password encryption
  license.mjs        # License validation logic
  email-template.mjs # Template processing
  attachment-converter.mjs # Attachment format conversion
public/
  app.html           # Main application (ribbon UI)
  activate.html      # License activation page
  css/styles.css     # Application styles
  js/app.js          # Global utilities
  js/user.js         # Application logic
```

## License System

The app requires a license key on first launch. The license validation module (`services/license.mjs`) is a placeholder stub that accepts any key with 8+ characters. Replace the `activateLicense()` function with your actual license server validation.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3000 |
| `ENCRYPTION_KEY` | 32-char key for SMTP password encryption | Auto-generated |
