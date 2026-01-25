UUID = tailscale-gnome-qs@tailscale-qs.github.io
BUNDLE_PATH = "$(UUID).zip"
EXTENSION_DIR = "$(UUID)"

all: build install

.PHONY: build install clean

build:
	rm -f $(BUNDLE_PATH); \
	cd $(EXTENSION_DIR); \
	gnome-extensions pack --force --podir=locale \
	                      --extra-source=icons/ \
	                      --extra-source=tailscale.js \
	                      --extra-source=mullvad.js \
	                      --extra-source=timeout.js \
	                      --extra-source=compat.js; \
	mv $(EXTENSION_DIR).shell-extension.zip ../$(BUNDLE_PATH)

install:
	gnome-extensions install $(BUNDLE_PATH) --force

enable:
	dbus-run-session -- gnome-extensions enable $(UUID)

run:
	dbus-run-session -- gnome-shell --nested --wayland

clean:
	@rm -fv $(BUNDLE_PATH)
