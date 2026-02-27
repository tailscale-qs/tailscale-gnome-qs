# Tailscale GNOME Quick Settings

[![Get it on GNOME Extensions](https://raw.githubusercontent.com/andyholmes/gnome-shell-extensions-badge/master/get-it-on-ego.svg?sanitize=true)](https://extensions.gnome.org/extension/9193/tailscale-qs/)

A GNOME Shell extension that adds Tailscale VPN controls directly to your Quick Settings panel for seamless network management.

---

## About

This extension provides a convenient Quick Settings toggle for managing your Tailscale VPN connection directly from the GNOME Shell system menu. No need to open a terminal or separate application — control your Tailscale connection with a single click.

## Project History

This project is a continuation and modernisation of [joaophi/tailscale-gnome-qs](https://github.com/joaophi/tailscale-gnome-qs), which is no longer actively maintained. Development has continued here to ensure compatibility with current GNOME Shell versions and to incorporate community fixes and improvements.

---

## Features

- **Quick Toggle** — Enable/disable Tailscale directly from the Quick Settings panel
- **Exit Nodes** — Select and disconnect exit nodes, including Mullvad support with country flag display
- **Multi-Account** — Switch between multiple Tailscale accounts (profiles)
- **Status Indicator** — Visual indication of your Tailscale connection status
- **Lightweight** — Minimal resource usage and system impact
- **Native Integration** — Seamlessly integrates with GNOME Shell's design language

## Requirements

- GNOME Shell 45 or newer
- Tailscale installed and configured on your system
- User configured as Tailscale operator (see [Configuration](#configuration) below)

---

## Installation

### Via GNOME Extensions (Recommended)

Install directly from [GNOME Extensions](https://extensions.gnome.org/extension/9193/tailscale-qs/) — simply visit the page and toggle the switch to install.

### Manual Installation

After cloning the repository, install build dependencies for your distro then run `make build && make install`.

**Ubuntu/Debian**
```bash
sudo apt update && sudo apt install make gettext gnome-shell
```

**Fedora/RHEL**
```bash
sudo dnf install make gettext gnome-shell
```

**Arch Linux**
```bash
sudo pacman -S make gettext gnome-shell
```

**Then build and install:**
```bash
git clone https://github.com/tailscale-qs/tailscale-gnome-qs.git
cd tailscale-gnome-qs
make build
make install
```

After installation you may need to either log out and back in, or restart GNOME Shell by pressing `Alt+F2`, typing `r`, and pressing Enter (X11 only). Then enable the extension:

```bash
gnome-extensions enable tailscale-gnome-qs@tailscale-qs.github.io
```

---

## Configuration

For the extension to work properly, configure your user as a Tailscale operator. This allows control of Tailscale without requiring root privileges for every operation:

```bash
sudo tailscale set --operator=$USER
```

---

## Usage

1. Click on the Quick Settings panel (top-right corner of your screen)
2. Look for the Tailscale toggle
3. Click to connect/disconnect from your Tailscale network

---

## Troubleshooting

**Extension not appearing**
- Ensure the extension is enabled: `gnome-extensions list --enabled`
- Check GNOME Shell version compatibility: `gnome-shell --version`
- Review extension logs: `journalctl -f -o cat /usr/bin/gnome-shell`

**Permission errors**
- Verify operator status: `tailscale status`
- Re-run the operator configuration: `sudo tailscale set --operator=$USER`
- Log out and back in to refresh permissions

**Extension crashes GNOME Shell**
- Disable the extension: `gnome-extensions disable tailscale-gnome-qs@tailscale-qs.github.io`
- Check compatibility with your GNOME Shell version
- [Report the issue](https://github.com/tailscale-qs/tailscale-gnome-qs/issues) on GitHub

---

## Contributing

Contributions are welcome — bug reports, feature requests, and code contributions alike.

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature-name`
3. Commit your changes: `git commit -am 'Add some feature'`
4. Push to your fork: `git push origin feature/your-feature-name`
5. Open a Pull Request against the `develop` branch

**Development setup:**
```bash
git clone https://github.com/YOUR_USERNAME/tailscale-gnome-qs.git
cd tailscale-gnome-qs
make build
make install
```

---

## Acknowledgements

- **Original Author:** [joaophi](https://github.com/joaophi) — created the original tailscale-gnome-qs extension
- **Mullvad improvements:** [abn](https://github.com/abn)
- See [CONTRIBUTORS.md](CONTRIBUTORS.md) for a full list of contributors

## Support

- **Bug Reports:** [GitHub Issues](https://github.com/tailscale-qs/tailscale-gnome-qs/issues)
- **Tailscale Docs:** [tailscale.com/kb](https://tailscale.com/kb)

## License

GNU General Public License v3.0 — see [LICENSE](LICENSE) for details.

---

> This extension is not officially affiliated with Tailscale Inc. It is a community-maintained project.