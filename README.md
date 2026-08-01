# [ROM Rack](https://romrack.com/)

ROM Rack is a web-based application that allows users to manage and organize their Wii U, Wii, GameCube, and 3DS game libraries. It provides features such as game categorization, search and filter functionality, the ability to track title statuses (e.g., complete, incomplete, etc.), download homebrew and other titles, and copy titles to an SD card. The application is built with the aim to be cross-platform.

Work in Progress

## Table of Contents

- [Features](#features)
- [Supported Platforms](#supported-platforms)
- [Prerequisites](#prerequisites)
- [Release](#release)
- [Configuration](#configuration)
- [Development](#development)
- [API](#api)
- [Title Data](#title-data)
- [Contributing](#contributing)
- [License](#license)
- [TODO](#todo)
- [Acknowledgements](#acknowledgements)

## Features

- Browse library - view your games grouped by title.
- Search & filters - find games by name, region, or download status.
- Download titles - select versions and start downloads on supported platforms.
- Manage downloads - see progress, retry, or clear failed items.
- Manage local copies - list stored titles and delete unwanted ones.
- Copy to SD card - select titles and copy to an inserted FAT32 SD.
- Title verification - view broken files and delete or re-download them.
- Detail sidebar - quick access to synopsis, version, size, and status.

## Supported Platforms

| Platform | Formats                         |
| -------- | ------------------------------- |
| 3DS      | `.3ds`, `.cci`, `.cia`          |
| GameCube | `.iso`, `.gcm`, `.rvz`          |
| Wii      | `.iso`, `.wbfs`, `.rvz`         |
| Wii U    | `.wud`, `.wux`, WUP directories |

## Prerequisites

For packaged releases, no system Node.js or Yarn installation is required. The packaged launch scripts download and verify a Node.js runtime on first run.

Development from source requires [Node 24](https://nodejs.org/) and [Yarn](https://yarnpkg.com/).

## Configuration

`config.json` lives at `~/.romrack/config.json`. ROM Rack creates it on first startup. By default, every library root is the same `~/.romrack` directory; change the roots to the directories containing your games.

Available options:

```json
{
    "host": "127.0.0.1",
    "port": 3000,
    "openBrowser": true,
    "3dsRoots": ["<home>/.romrack"],
    "gamecubeRoots": ["<home>/.romrack"],
    "wiiRoots": ["<home>/.romrack"],
    "wiiuRoots": ["<home>/.romrack"]
}
```

`<home>` above represents your actual home directory; the generated file contains its absolute path.

`host` sets the network host ROM Rack binds to.

`port` sets the port ROM Rack listens on.

`openBrowser` controls whether ROM Rack opens your browser on startup using the configured host and port.

`3dsRoots` is a list of 3DS library directories.

`gamecubeRoots` is a list of GameCube library directories.

`wiiRoots` is a list of Wii library directories.

`wiiuRoots` is a list of Wii U title directories.

### Keys

ROM Rack looks for these key files only when a format needs them:

- `~/.romrack/aes_keys.txt` contains 3DS AES keys. They are used to read metadata from encrypted NCCH content and to decrypt and verify CIA contents. ROM Rack tries to download this file if it is missing. The file must include `generatorConstant`; current 3DS operations use `slot0x2CKeyX`, `slot0x3DKeyX`, and the applicable `common0` through `common5` keys.
- `~/.romrack/common.key` contains the Wii U common key. It is used to decrypt Wii U title metadata and content. ROM Rack tries to download it if it is missing. It may be raw 16-byte binary or 32 hexadecimal characters.
- `<disc-name>.key` next to a `.wud` or `.wux`, or `game.key` in the same directory, contains that image's 16-byte Wii U disc key. The disc key is required to open, verify, or convert that specific disc image; the common key cannot be used in its place. WUD/WUX processing uses both keys: the disc key opens the image and the common key decrypts the title content inside it. ROM Rack does not download per-disc keys.

GameCube and Wii disc images do not require separate key files.

## Release

From a packaged release:

1. Download the latest release zip from GitHub.
2. Extract the release zip.
3. Run `romrack.exe` on Windows or `./romrack` on macOS/Linux.
4. Set your library directories in Settings, or edit the generated `~/.romrack/config.json`.

The default configuration listens only on `127.0.0.1:3000`, opens the app in your browser, and scans `~/.romrack` for every supported platform.

## Development

Clone the repository.

```bash
git clone https://github.com/qwell/romrack.git
```

Navigate to the repo directory.

```bash
cd romrack
```

Install dependencies using Yarn.

```bash
yarn install
```

Build and run from source.

```bash
yarn build
yarn start
```

## Available Scripts

- `lint`: Run ESLint to check for code quality issues.

```bash
yarn lint
```

- `format`: Run Prettier to format the code.

```bash
yarn format
```

- `clean`: Clean up generated artifacts.

```bash
yarn clean
```

- `build`: Compile TypeScript files and output in the `dist/` directory.

```bash
yarn build
```

- `start`: Execute the server.

```bash
yarn start
```

- `test`: Execute tests with Vitest.

```bash
yarn test
```

- `release`: Build a versioned release zip in `release/`.

```bash
yarn release
```

- `generate:titles`: Regenerate title data.

```bash
yarn generate:titles
```

`yarn generate:titles` is only needed when refreshing the checked-in title data. By default it reads `titles/3ds/nus.json` and `titles/wiiu/nus.json`, rebuilds `titles/titles.json`, and supplements `titles/icons.json`. It downloads Nintendo metadata directly; the ROM Rack server does not need to be running.

Generation options:

- `--refresh-catalog`: Refresh Nintendo Samurai/Ninja catalog membership while preserving cached CDN metadata.
- `--refresh-metadata`: Recheck cached NUS metadata and CDN availability.
- `--refresh-versions`: Rebuild historical NUS version information.
- `--refresh-tdb`: Download current Wii, Wii U, and 3DS GameTDB XML files.
- `--refresh-all`: Enable all four refresh operations above.
- `--extract-icons`: Extract title icons while refreshing metadata; requires `--refresh-metadata`.
- `--scan-generated-ranges`: Probe the configured generated title-ID ranges; requires both `--refresh-catalog` and `--refresh-metadata`.
- `--limit N`: Limit Samurai catalog sampling during a catalog refresh; cannot be combined with `--refresh-versions`.

Combine `--refresh-catalog` and `--refresh-metadata` to discover catalog titles and validate their NUS availability in the same run.

## API

- `GET /api/library`: Queue a library scan, or return the active scan without starting another.
- `GET /api/library/organize`: Preview canonical library organization and conflicts.
- `POST /api/library/organize`: Queue canonical library organization, or return the active organization without starting another.
- `GET /api/library/verify`: Fully verify library file integrity and report progress.
- `GET /api/library/convert?titleId=...`: Queue WUD/WUX conversion for a title.
- `GET /api/media/:type/:platform/:productCode`: Read or cache title icon/cover media.
- `GET /api/title/:platform?titleId=...`: Fetch available title metadata for a supported platform.
- `GET/POST /api/config`: Read or update configuration.
- `POST /api/config/validate-root`: Validate a proposed library directory.
- `GET /api/storage/list-fat32`: List FAT32 storage destinations. On WSL, unmounted Windows-only drives are returned for display but must be mounted in WSL before use.
- `GET /api/storage/copy?titleId=...&platform=...&dest=...`: Queue a local title copy to a FAT32 destination.
- `GET /api/storage/move?titleId=...&platform=...&dest=...`: Queue a local title move to a FAT32 destination and remove the local source after a successful copy.
- `GET /api/storage/delete?titleId=...&platform=...`: Queue deletion of all local copies for a title ID. `platform` is optional when the title ID identifies the platform unambiguously.

## WebSocket API

The browser connects to `/api/socket`. On connection the server sends an `app.connected` event with the current state (downloads, storage copies, storage deletes, library scans, library organization, library verification events, WUD/WUX conversions, and title validation results).

Server events:

- `app.connected`: Initial app state payload (`serverId`, `downloads`, `storageCopies`, `storageDeletes`, `libraryScans`, `libraryOrganizeItems`, `libraryVerifyEvents`, `libraryConversions`, `titleValidations`).
- `download.queue.changed`: Current download queue updates.
- `storage.copy.changed`: Current storage copy/move queue updates.
- `storage.delete.changed`: Current storage delete queue updates.
- `library.scan.changed`: Library scan progress, status, and terminal groups.
- `library.organize.changed`: Canonical library organization progress and status.
- `library.verify.changed`: Full library verification progress, clear, and status updates; cancelled runs include completed and total entry counts.
- `library.convert.changed`: Current WUD/WUX conversion queue.
- `title.validate.changed`: Size-only title validation progress and results.

Client commands:

- `download.queue`: Queue title downloads (payload: items).
- `download.retry`: Retry a failed download (payload: id).
- `download.clear`: Clear a download entry (payload: id).
- `download.cancel`: Cancel an active download (payload: id).
- `storage.copy.retry`: Retry a storage copy/move (payload: id).
- `storage.copy.clear`: Clear a storage copy/move entry (payload: id).
- `storage.copy.cancel`: Cancel an active storage copy/move (payload: id).
- `storage.delete.retry`: Retry a storage delete operation (payload: id).
- `storage.delete.clear`: Clear a storage delete entry (payload: id).
- `storage.delete.cancel`: Cancel a storage delete operation (payload: id).
- `library.scan.clear`: Clear a terminal library scan (payload: id).
- `library.organize.cancel`: Cancel an active library organization (payload: id).
- `library.organize.clear`: Clear a terminal library organization (payload: id).
- `library.organize.retry`: Retry a failed or cancelled library organization (payload: id).
- `library.verify.cancel`: Cancel an in-progress full library verification.
- `library.verify.clear`: Clear a failed verification item (payload: id).
- `library.verify.download`: Queue downloads for verification failures.
- `library.convert.cancel`: Cancel a WUD/WUX conversion queue entry (payload: id).
- `library.convert.clear`: Clear a WUD/WUX conversion queue entry.
- `library.convert.retry`: Retry a failed WUD/WUX conversion.
- `title.validate.queue`: Queue validation for a local title (payload: `{ id, name, platform }`).

## Title Data

Files in `titles/`:

- `titles.json`: Generated primary title database.
- `icons.json`: Generated title icon URLs.

- `wiiu/nus.json`: Cached Wii U catalog, localized metadata, CDN availability, and version data.
- `3ds/nus.json`: Cached 3DS catalog, localized metadata, CDN availability, and version data.

- `wii/tdb.xml`: Source Wii TDB XML from [GameTDB](https://www.gametdb.com/wiitdb.zip), used for Wii and GameCube supplemental title data and UI details.
- `wiiu/tdb.xml`: Source Wii U TDB XML from [GameTDB](https://www.gametdb.com/wiiutdb.zip), used by the UI for title details.
- `3ds/tdb.xml`: Source 3DS TDB XML from [GameTDB](https://www.gametdb.com/3dstdb.zip), used by the UI for title details.

- `wiiu/wiiubrew.csv`: Exported Wii U CSV for supplemental title data from [WiiUBrew](https://wiiubrew.org/wiki/Title_database).

- `3ds/hshop.json`: Browser-exported 3DS supplemental hShop title data. See `titles/3ds/README.hshop.md` for details.

## Contributing

If you'd like to contribute, pull requests and issues are always appreciated.

## License

ROM Rack is licensed under the [GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html) or later.

## TODO

- Show when newer versions of base titles, updates, or DLC are available.

## Acknowledgements

Thanks to [GameTDB](https://gametdb.com/) for the supplemental title databases, icons, and banner images.

Thanks to [hShop](https://hshop.erista.me/) for the supplemental 3DS title database.

Thanks to [WiiUBrew](https://wiiubrew.org/) for the supplemental Wii U title database.
