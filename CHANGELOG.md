# Changelog

All notable changes to this project are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] — 2026-05-31

### Added

- Chromium source generation and packaging with a Chrome-compatible Manifest V3
  service worker build in `dist/chromium`.
- Separate Firefox and Chromium lint/build commands, CI coverage for both
  manifest variants, and manifest tests for browser-specific fields.
- Optional Chrome Web Store API v2 release publishing after the listing and
  privacy setup are completed manually.

### Changed

- Extension manifests now reference PNG icon assets while keeping the SVG as the
  editable source icon.
- Raise the minimum Firefox version to 140 to match the
  `data_collection_permissions` declaration, which is supported from Firefox 140.

### Fixed

- Chromium builds now keep the manifest description within Chrome's 132
  character limit.

## [0.1.0] — 2026-05-31

### Added

- Initial release: a native-looking dark theme for the Claude Design
  (`claude.ai/design`) native panels.
- Toolbar toggle to enable/disable the theme; state persists across sessions.
- Value-based, role-aware color remap that survives styled-components class
  churn across Claude builds, plus a luminance fallback for shades not in the
  token table.
- The cross-origin design preview iframe is never touched; turning the
  extension off restores the page byte-for-byte.
