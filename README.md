# openmprdb-cli-example
Example client for NyaaCat/OpenMPRDB

# Setup

1. Clone this repo
2. `npm install`
3. Copy `config.js.example` to `config.js` and edit as your info
4. Create `submits.json` with content `{}`
5. Copy your `banned-players.json` here

# Use

- Generate keypair: `node index.js init`
- Register on server: `node index.js reg`
- Synchronize banlist: `node index.js sync`
- Manually submit: `node index.js manual <player uuid> <point: [-1, -0.1] || [0.1, 1]> <comment>`
- Revoke submit: `node index.js revoke <submit uuid> <comment>`
