# RosettaNet Viewer

A React-based viewer for RosettaNet specifications (HTML/Text format). Parses and displays the tree structure of RosettaNet message definitions.

## Features

- **Upload & Parse**: Supports `.htm`, `.html` and `.txt` files containing RosettaNet table definitions.
- **Tree View**: Visualize the hierarchical structure (indentation based on pipe `|` characters).
- **Search**:
  - Keyword search
  - Path search (e.g., `/Pip3A4/ServiceHeader/ProcessControl`)
  - Auto-resolve `Choice` nodes
- **Firebase Integration**: Load and save templates directly to Firebase Realtime Database.

## Setup

1.  Clone the repository.
2.  `npm install`
3.  `npm run dev`

## Firebase Setup

This application uses Firebase Realtime Database to store HTML templates.

### Database Rules

For development, you can use open rules (not recommended for production):

```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

For production, consider implementing authentication and proper security rules.

### Data Structure

The application stores files in the following structure:

```
/files
  /{filename}
    - content: "HTML content string"
    - updated: "ISO timestamp"
```

### Configuration

The Firebase configuration is located in `src/firebase.js`. Update the `firebaseConfig` object if you need to use a different Firebase project.
