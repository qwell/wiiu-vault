# Changelog

## [v0.3.0] - 2026-08-03

### Added

- Added GameCube library support, including scanning, metadata, verification, storage operations, and SD-card layouts.
- Added RVZ support for Wii and GameCube titles.
- Added library-wide organization for title directories and ROM filenames, including previews, conflict detection, progress reporting, cancellation, and retry support.
- Added library-scan progress and controls to the action bar.
- Added automatic title verification after copying titles to FAT32 storage.
- Added deeper 3DS CIA verification, including decrypted content hash validation.
- Added support for localized 3DS and Wii U metadata sourced from Samurai and CDN data.
- Added historical title-version generation and expanded title catalog refresh options.

### Changed

- Refactored platform and format handling into platform-specific adapters with shared scanning, verification, storage, and metadata workflows.
- Improved title metadata generation to discover and validate substantially more 3DS and Wii U titles directly against catalog and CDN data.
- Improved GameTDB archive caching and media lookup behavior.
- Prevented expired media caches from triggering unnecessary bulk refreshes.
- Improved Wii U ticket parsing and generated-ticket handling.
- Updated download controls so they appear only for titles and platforms with supported download formats.
- Updated storage, title-validation, and WebSocket operations to use platform-qualified title identities.
- Updated supported-platform, configuration, key-file, release, API, and title-generation documentation.

### Fixed

- Fixed Korean-region detection for NTSC-K titles.
- Fixed Virtual Console classification in affected title metadata.
- Improved error detection and reporting across filesystem, HTTP, metadata, and platform workflows.

## [v0.2.1] - 2026-07-12

### Added

- Added a scroll jump bar for navigating the library.
- Added console search and badge-click filtering for regions, Virtual Console types, and consoles.
- Added Wii and 3DS SD-card copy support.
- Added Wii title verification support.
- Added support for Wii U demo (and UWUVCI AIO-injected) titles.
- Added cover image placeholders with correct aspect ratios, loading states, and failed-image states.

### Changed

- Improved badge alignment, sizing, tooltips, colors, borders, and header spacing.
- Improved region and Virtual Console filter handling by removing hardcoded region behavior.
- Improved GameTDB handling:
    - Prefer local archives.
    - Rebuild cached archive indexes without unnecessary network requests.
    - Probe TDB ZIP file lists before downloading.
    - Use non-English synopses when English text is unavailable.
- Split server route handling into separate route and action layers.
- Improved title platform typing across the codebase.
- Reduced unnecessary FAT32 device scans to library-refresh flows.
- Replaced hardcoded filenames with constants.
- Updated default ROM root behavior when config does not specify one.

### Fixed

- Fixed badge width and row alignment issues.
- Fixed direct Node runtime path handling.
- Prevented library verification work from blocking HTTP requests.
- Removed an unnecessary import.
- Adjusted config candidate display formatting.
- Optimized logo SVG and updated the app logo.

## [v0.2.0] - 2026-07-08

## [v0.1.0] - 2026-06-08

- Initial public release.
- Name has been changed to ROM Rack.

### Added

- Added Wii support.
- Added 3DS support.
- Added Virtual Console badges and filtering.
- Added download support in the UI.
- Added library validation UI.
- Added config settings sidebar and API.
- Added support for copying files to SD cards and other FAT32 partitions.
- Added multi-platform release builds.
- Added native launcher binaries.

### Changed

- Major refactors.
- Significant improvements to media handling.
- Split the release workflow to support future signing.
- Switched the project license to GPLv3 or later.
- Updated README documentation for newer features.
- Improved config handling and UI state syncing.
- Improved release packaging.

### Fixed

- Removed an unnecessary Windows prompt.
- Improved heartbeat behavior and error handling.
