# Sample Repo for Yarn v2+, TypeScript, ESLint, Prettier, and VS Code

This repository demonstrates a simple setup using:

- VS Code
- TypeScript
- ESLint
- Prettier
- Yarn
  - Plug'n'Play (PnP)
  - editor SDKs
- Vitest

## Table of Contents

- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Available Scripts](#available-scripts)
- [Contributing](#contributing)
- [License](#license)
- [TODO](#todo)

## Prerequisites

- [Visual Studio Code](https://code.visualstudio.com/)
- [Node 20](https://nodejs.org/)
- [Yarn](https://yarnpkg.com/)

## Setup

Clone the repository and navigate to the directory.

```bash
git clone https://github.com/qwell/happy-ts.git
```

Navigate to the repo directory.

```bash
cd happy-ts
```

Install dependencies using Yarn.

```bash
yarn install
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

- `clean`: Clean up generated artifacts (like the `dist/` directory).

```bash
yarn clean
```

- `build`: Compile TypeScript files and output in the `dist/` directory.

```bash
yarn build
```

- `start`: Execute the compiled `dist/index.js`.

```bash
yarn start
```

- `test`: Execute tests with Vitest.

```bash
yarn test
```

## Contributing

If you'd like to contribute, pull requests and issues are always appreciated.

## License

[GPLv3](https://www.gnu.org/licenses/gpl-3.0.en.html)

## TODO

- Add Yarn workspaces/monorepo support (written, not yet committed).
