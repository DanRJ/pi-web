# @jmfederico/pi-web-tunnel

Local `pi-web-tunnel` CLI package for PI WEB Safe Tunnels.

The connector owns local tunnel credentials and foreground `frpc` supervision. PI WEB invokes it as an optional command instead of importing connector internals, so users who do not enable Safe Tunnel do not need to run it.
