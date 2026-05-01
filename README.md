# Wii U Vault

Wii U Vault is a web-based application that allows users to manage and organize their Wii U game library. It provides features such as game categorization, search and filter functionality, and the ability to track game statuses (e.g., complete, incomplete, etc.). The application is built using TypeScript and Node.js. The aim is to be cross-platform.

Work in Progress

## Table of Contents

- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Configuration](#configuration)
- [Available Scripts](#available-scripts)
- [API](#api)
- [Title Data](#title-data)
- [Contributing](#contributing)
- [License](#license)
- [TODO](#todo)

## Prerequisites

- [Node 24](https://nodejs.org/)
- [Yarn](https://yarnpkg.com/)

## Setup

Clone the repository.

```bash
git clone https://github.com/qwell/wiiu-vault.git
```

Navigate to the repo directory.

```bash
cd wiiu-vault
```

Install dependencies using Yarn.

```bash
yarn install
```

Copy the sample config.

```bash
cp config.sample.json config.json
```

## Configuration

`config.json` is required. Copy it from `config.sample.json`, then set `roms.wiiuRoot` to your Wii U title directory.

For title metadata generation or title downloads, put `common.key` in either `~/.wiiu/common.key` or the app root. The key may be raw 16-byte binary, hex text, or comma-separated byte literals.

## Available Scripts

- `lint`: Run ESLint to check for code quality issues.

```bash
yarn lint
```

- `format`: Run Prettier to format the code.

```bash
yarn format
```

- `clean`: Clean up generated artifacts (like the `dist/` directory).

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

- `generate:titles`: Regenerate title data.

```bash
yarn generate:titles
```

`yarn generate:titles` only needs to be run when refreshing the checked-in title databases, updating `titles/titledb.csv`, rebuilding WiiUTDB data, or supplementing icons, and is only necessary in very specific cases. The Wii U Vault server must already be running because the generator calls the local metadata endpoints.

## API

- `GET /api/library?includeAll=true`: Scan the configured library. Omit `includeAll` to return only groups with local entries.
- `GET /api/title-icon/:family`: Proxy/cache a title icon from the title database.
- `GET /api/title-metadata?titleId=...`: Fetch base NUS metadata for a title ID.
- `GET /api/title-update?titleId=...`: Check the update title ID and latest update version for a base title.
- `GET /api/title-dlc?titleId=...`: Check the DLC title ID and latest DLC version for a base title.
- `GET /api/title-all?titleId=...`: Fetch base metadata plus update and DLC availability.
- `GET /api/title-download?titleId=...`: Download a base, update, or DLC title into `roms.wiiuRoot`, generate install files, and verify content hashes.

## Title Data

Files in `titles/`:

- `titles.json`: Generated primary title database.
- `extra.json`: Generated supplemental entries from `titledb.csv`.
- `icons.json`: Generated title icon URLs.
- `exclude.json`: Title IDs skipped by generation.
- `titledb.csv`: Source CSV for supplemental title data from [WiiUBrew](https://wiiubrew.org/wiki/Title_database).
- `wiiutdb.xml`: Source WiiUTDB XML from [GameTDB](https://gametdb.com).
- `wiiutdb.json`: Generated WiiUTDB details used by the UI.

## Contributing

If you'd like to contribute, pull requests and issues are always appreciated.

## License

[GPLv3](https://www.gnu.org/licenses/gpl-3.0.en.html)

## TODO

- Show when newer versions of base titles, updates, or DLC are available.
- Download titles from the UI.
