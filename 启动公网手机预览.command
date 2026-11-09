#!/bin/zsh
set -e
cd -- "$(dirname -- "$0")"
if [ ! -d node_modules ]; then
  npm install
fi
unset REACT_NATIVE_PACKAGER_HOSTNAME
exec npm run tunnel
