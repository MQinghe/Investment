#!/bin/zsh
set -e
cd -- "$(dirname -- "$0")"
if [ ! -d node_modules ]; then
  npm install
fi
ledger_wifi_host=$(node -e 'const a=require("os").networkInterfaces().en0||[]; console.log(a.find(x=>x.family==="IPv4"&&!x.internal)?.address||"")')
if [ -n "$ledger_wifi_host" ]; then
  export REACT_NATIVE_PACKAGER_HOSTNAME="$ledger_wifi_host"
fi
exec npm start -- --lan --port 8082
