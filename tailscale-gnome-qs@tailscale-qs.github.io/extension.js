/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

/* exported init */
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import St from 'gi://St';
import GLib from 'gi://GLib';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';

// This is the live instance of the Quick Settings menu
const QuickSettingsMenu = Main.panel.statusArea.quickSettings;

import {Tailscale} from './tailscale.js';
import {filterMullvadNodes, createMullvadExitNodeButton} from './mullvad.js';

export const DisableExitNodeButton = GObject.registerClass(
  class DisableExitNodeButton extends St.Button {
      _init(tailscale) {
          const isExitNodeActive = tailscale.exit_node !== '';

          super._init({
              style_class: 'icon-button',
              can_focus: true,
              icon_name: 'network-vpn-symbolic',
              accessible_name: _('disable exit node'),
              reactive: isExitNodeActive,
          });

          this._exitNodeClicked = this.connect('clicked', () => {
              tailscale.exit_node = '';
              this.reactive = false;
              return true;
          });
      }
  }
);

const TailscaleIndicator = GObject.registerClass(
  class TailscaleIndicator extends QuickSettings.SystemIndicator {
      _init(icon, tailscale) {
          super._init();

          this._tailscale = tailscale;
          // Create the icon for the indicator
          const up = this._addIndicator();
          up.gicon = icon;
          tailscale.bind_property('running', up, 'visible', GObject.BindingFlags.SYNC_CREATE | GObject.BindingFlags.DEFAULT);

          // Create the icon for the indicator
          const exit = this._addIndicator();
          exit.icon_name = 'network-vpn-symbolic';
          const setVisible = () => {
              exit.visible = tailscale.running && tailscale.exit_node !== '';
              return true;
          };
          tailscale.connectObject('notify::exit-node', () => setVisible(), this);
          tailscale.connectObject('notify::running', () => setVisible(), this);
          setVisible();
      }

      destroy() {
          this._tailscale.disconnectObject(this);
          super.destroy();
      }
  }
);

const TailscaleDeviceItem = GObject.registerClass(
  class TailscaleDeviceItem extends PopupMenu.PopupBaseMenuItem {
      _init(iconName, text, subtitle, onClick, onLongClick) {
          super._init({
              activate: onClick,
          });

          const icon = new St.Icon({
              style_class: 'popup-menu-icon',
          });
          this.add_child(icon);
          icon.icon_name = iconName;

          const label = new St.Label({
              x_expand: true,
          });
          this.add_child(label);
          label.text = text;

          const sub = new St.Label({
              style_class: 'device-subtitle',
          });
          this.add_child(sub);
          sub.text = subtitle;

          this._connectEvents = [];
          this._connectEvents.push(this.connect('activate', () => onClick?.()));

          const shellVersion = parseInt(Config.PACKAGE_VERSION.split('.')[0]);

          if (shellVersion >= 47) {
              const clickGesture = this._clickGesture ?? (() => {
                  const action = new Clutter.ClickGesture();
                  this.add_action(action);
                  this._connectEvents.push(action.connect('notify::pressed', () => {
                      if (action.pressed)
                          this.add_style_pseudo_class('active');
                      else
                          this.remove_style_pseudo_class('active');
                  }));
                  this._connectEvents.push(action.connect('recognize', () => this.activate(Clutter.get_current_event())));
                  return action;
              })();
              clickGesture.enabled = true;

              const longPressGesture = this._longPressGesture ?? (() => {
                  const action = new Clutter.LongPressGesture();
                  this.add_action(action);
                  this._connectEvents.push(action.connect('notify::pressed', () => {
                      if (action.pressed)
                          this.add_style_pseudo_class('active');
                      else
                          this.remove_style_pseudo_class('active');
                  }));
                  this._connectEvents.push(action.connect('recognize', () => onLongClick()));
                  return action;
              })();
              longPressGesture.enabled = true;
          } else {
              // GNOME 46 fallback - use traditional click handling
              this._pressTimeout = null;

              this._connectEvents.push(this.connect('button-press-event', (_actor, event) => {
                  if (event.get_button() === 1) {
                      if (this._pressTimeout !== null) {
                          GLib.Source.remove(this._pressTimeout);
                          this._pressTimeout = null;
                      }
                      this._pressTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, () => {
                          this._pressTimeout = null;
                          onLongClick?.();
                          return GLib.SOURCE_REMOVE;
                      });
                  }
                  return Clutter.EVENT_PROPAGATE;
              }));

              this._connectEvents.push(this.connect('button-release-event', (_actor, event) => {
                  if (event.get_button() === 1) {
                      if (this._pressTimeout) {
                          // Released before long press fired - treat as normal click
                          GLib.Source.remove(this._pressTimeout);
                          this._pressTimeout = null;
                          onClick?.();
                      }
                      return Clutter.EVENT_STOP;
                  }
                  return Clutter.EVENT_PROPAGATE;
              }));
          }
      }

      activate(event) {
          if (this._activatable)
              this.emit('activate', event);
      }

      vfunc_button_press_event() { }

      vfunc_button_release_event() { }

      vfunc_touch_event(_touchEvent) { }

      destroy() {
          if (this._pressTimeout !== null) {
              GLib.Source.remove(this._pressTimeout);
              this._pressTimeout = null;
          }
          super.destroy();
      }
  }
);

const TailscaleProfileItem = GObject.registerClass(
  class TailscaleProfileItem extends PopupMenu.PopupBaseMenuItem {
      _init(title, subtitle, enabled, onClick) {
          super._init({
              activate: onClick,
          });

          const label = new St.Label({
              x_expand: true,
          });
          this.add_child(label);
          label.text = title;

          const sub = new St.Label({
              style_class: 'device-subtitle',
          });
          this.add_child(sub);
          sub.text = subtitle;

          if (enabled) {
              const icon = new St.Icon({style_class: 'system-status-icon'});
              this.add_child(icon);
              icon.icon_name = 'object-select-symbolic';
          }

          this.connect('activate', () => onClick());
      }

      activate(event) {
          if (this._activatable)
              this.emit('activate', event);
      }
  }
);

const PopupScrollableSubMenuMenuItem = GObject.registerClass(
  class PopupScrollableSubMenuMenuItem extends PopupMenu.PopupSubMenuMenuItem {
      _init(props) {
          super._init(props);

          this.menu._needsScrollbar = () => true;
          this.menu.box.height = 200;
      }
  }
);

const TailscaleMenuToggle = GObject.registerClass(
  class TailscaleMenuToggle extends QuickSettings.QuickMenuToggle {
      _getIconName(node) {
          if (!node.online)
              return 'network-offline-symbolic';

          if (node.os === 'android' || node.os === 'iOS')
              return 'phone-symbolic';

          if (node.mullvad)
              return 'network-vpn-symbolic';

          return 'computer-symbolic';
      }

      _getNodeSubtitle(node, isSelfExitNode) {
          if (node.exit_node)
              return _('disable exit node');
          if (isSelfExitNode && node.exit_node_option)
              return _('exit node');
          if (node.exit_node_option)
              return _('use as exit node');

          return '';
      }

      _nodeSortingFunction(a, b) {
          return (b.exit_node - a.exit_node) ||
        (b.exit_node_option - a.exit_node_option) ||
        (b.online - a.online) ||
        a.name.localeCompare(b.name);
      }

      _init(icon, tailscale) {
          super._init({
              label: 'Tailscale',
              gicon: icon,
              toggleMode: true,
              menuEnabled: true,
          });

          this._tailscale = tailscale;
          this.title = 'Tailscale';
          tailscale.bind_property('running', this, 'checked', GObject.BindingFlags.SYNC_CREATE | GObject.BindingFlags.BIDIRECTIONAL);

          // Header action bar section
          const actionLayout = new Clutter.GridLayout();
          const actionBar = new St.Widget({
              layout_manager: actionLayout,
          });

          this.menu._headerSpacer.x_align = Clutter.ActorAlign.END;
          this.menu._headerSpacer.add_child(actionBar);

          const disableExitNodeButton = new DisableExitNodeButton(tailscale);
          actionLayout.attach(disableExitNodeButton, 0, 0, 1, 1);

          // This function is unique to this class. It adds a nice header with an
          // icon, title and optional subtitle. It's recommended you do so for
          // consistency with other menus.
          tailscale.connectObject('notify::exit-node-name', () => {
              this.subtitle = tailscale.exit_node_name;
              this.menu.setHeader(icon, this.title, this.subtitle);
              disableExitNodeButton.reactive = tailscale.exit_node !== '';
          }, this);
          this.menu.setHeader(icon, this.title, tailscale.exit_node_name);

          // NODES
          const mnodes = new PopupScrollableSubMenuMenuItem(_('Nodes'), false, {});
          this._nodes = new PopupMenu.PopupMenuSection();

          // Keep track of available Mullvad nodes
          let availableMullvadNodes = [];
          let mullvadButtonItem = null;

          const updateNodes = obj => {
              this._nodes.removeAll();
              const isSelfExitNode = obj.selfNode.ExitNodeOption;

              // Separate Mullvad nodes from regular nodes and filter only online Mullvad nodes
              availableMullvadNodes = filterMullvadNodes(obj.nodes);
              const regularNodes = Object.values(obj.nodes).filter(node => !node.mullvad || node.exit_node).sort(this._nodeSortingFunction);

              // Add regular nodes to main menu
              for (const node of regularNodes) {
                  const deviceIcon = this._getIconName(node);
                  const subtitle = this._getNodeSubtitle(node, isSelfExitNode);
                  const onClick = !isSelfExitNode && node.exit_node_option ? () => {
                      tailscale.exit_node = node.exit_node ? '' : node.id;
                  } : null;
                  const onLongClick = () => {
                      if (!node.ips)
                          return false;

                      St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, node.ips[0]);
                      St.Clipboard.get_default().set_text(St.ClipboardType.PRIMARY, node.ips[0]);
                      Main.osdWindowManager.showAll(icon, _('IP address has been copied to the clipboard'));
                      return true;
                  };

                  this._nodes.addMenuItem(new TailscaleDeviceItem(deviceIcon, node.name, subtitle, onClick, onLongClick));
              }

              // Update Mullvad button visibility
              this._updateMullvadButton();
          };

          // Method to create or remove Mullvad button based on available nodes
          this._updateMullvadButton = () => {
              // Remove existing button if it exists
              if (mullvadButtonItem) {
                  mullvadButtonItem.destroy();
                  mullvadButtonItem = null;
              }

              // Create new button using the helper function
              mullvadButtonItem = createMullvadExitNodeButton(availableMullvadNodes, tailscale);

              // Add it to the main menu if it was created
              if (mullvadButtonItem)
                  this.menu.addMenuItem(mullvadButtonItem);
          };

          tailscale.connectObject('notify::nodes', obj => updateNodes(obj), this);
          mnodes.menu.addMenuItem(this._nodes);
          this.menu.addMenuItem(mnodes);

          // SEPARATOR
          this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

          // PREFS
          const prefs = new PopupMenu.PopupSubMenuMenuItem(_('Settings'), false, {});

          this._routes = new PopupMenu.PopupSwitchMenuItem(_('Accept routes'), tailscale.accept_routes, {});
          this._routes.activate = function (_event) {
              this.toggle();
          };
          tailscale.connectObject('notify::accept-routes', obj => this._routes.setToggleState(obj.accept_routes), this);
          this._routes.connectObject('toggled', item => {
              tailscale.accept_routes = item.state;
          }, this);
          prefs.menu.addMenuItem(this._routes);

          this._dns = new PopupMenu.PopupSwitchMenuItem(_('Accept DNS'), tailscale.accept_dns, {});
          this._dns.activate = function (_event) {
              this.toggle();
          };
          tailscale.connectObject('notify::accept-dns', obj => this._dns.setToggleState(obj.accept_dns), this);
          this._dns.connectObject('toggled', item => {
              tailscale.accept_dns = item.state;
          }, this);
          prefs.menu.addMenuItem(this._dns);

          this._lan = new PopupMenu.PopupSwitchMenuItem(_('Allow LAN access'), tailscale.allow_lan_access, {});
          this._lan.activate = function (_event) {
              this.toggle();
          };
          tailscale.connectObject('notify::allow-lan-access', obj => this._lan.setToggleState(obj.allow_lan_access), this);
          this._lan.connectObject('toggled', item => {
              tailscale.allow_lan_access = item.state;
          }, this);
          prefs.menu.addMenuItem(this._lan);

          this._shields = new PopupMenu.PopupSwitchMenuItem(_('Shields up'), tailscale.shields_up, {});
          this._shields.activate = function (_event) {
              this.toggle();
          };
          tailscale.connectObject('notify::shields-up', obj => this._shields.setToggleState(obj.shields_up), this);
          this._shields.connectObject('toggled', item => {
              tailscale.shields_up = item.state;
          }, this);
          prefs.menu.addMenuItem(this._shields);

          this._ssh = new PopupMenu.PopupSwitchMenuItem(_('SSH'), tailscale.ssh, {});
          this._ssh.activate = function (_event) {
              this.toggle();
          };

          tailscale.connectObject('notify::ssh', obj => this._ssh.setToggleState(obj.ssh), this);
          this._ssh.connectObject('toggled', item => {
              tailscale.ssh = item.state;
          }, this);
          prefs.menu.addMenuItem(this._ssh);

          this.menu.addMenuItem(prefs);

          // PROFILES
          const profiles = new PopupMenu.PopupSubMenuMenuItem(_('Profiles'), false, {});
          const updateProfiles = obj => {
              profiles.menu.removeAll();
              for (const p of obj.profiles) {
                  if (!p.NetworkProfile || !p.NetworkProfile.DomainName)
                      continue; // Skip invalid profiles
                  const enabled = obj._prefs.ControlURL === p.ControlURL && obj._prefs.Config.UserProfile.ID === p.UserProfile.ID;
                  const onClick = () => {
                      tailscale.profiles = p.ID;
                  };
                  profiles.menu.addMenuItem(new TailscaleProfileItem(p.NetworkProfile.DisplayName ? p.NetworkProfile.DisplayName : p.Name, p.NetworkProfile.DomainName, enabled, onClick));
              }
              return true;
          };
          tailscale.connectObject('notify::profiles', obj => updateProfiles(obj), this);
          this.menu.addMenuItem(profiles);
      }

      destroy() {
          this._tailscale.disconnectObject(this);
          [this._routes, this._dns, this._lan, this._ssh, this._shields].forEach(item => item.disconnectObject(this));
          this._nodes?.removeAll?.();
          this._nodes = null;
          this._routes = null;
          this._dns = null;
          this._lan = null;
          this._ssh = null;
          this._shields = null;
          super.destroy();
      }
  }
);

export default class TailscaleExtension extends Extension {
    _timeouts = [];

    enable() {
        const icon = Gio.icon_new_for_string(`${this.path}/icons/tailscale-symbolic.svg`);

        this._tailscale = new Tailscale();
        this._indicator = new TailscaleIndicator(icon, this._tailscale);
        this._menu = new TailscaleMenuToggle(icon, this._tailscale);
        if (QuickSettingsMenu.addExternalIndicator) {
            this._indicator.quickSettingsItems.push(this._menu);
            QuickSettingsMenu.addExternalIndicator(this._indicator);
        } else {
            const timerHandle = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                if (!QuickSettingsMenu._indicators.get_first_child())
                    return GLib.SOURCE_CONTINUE;

                QuickSettingsMenu._indicators.insert_child_at_index(this._indicator, 0);
                QuickSettingsMenu._addItems([this._menu]);
                QuickSettingsMenu.menu._grid.set_child_below_sibling(
                    this._menu,
                    QuickSettingsMenu._backgroundApps.quickSettingsItems[0]
                );

                // Remove from tracking and stop
                const index = this._timeouts.indexOf(timerHandle);
                if (index > -1)
                    this._timeouts.splice(index, 1);
                return GLib.SOURCE_REMOVE;
            });
            this._timeouts.push(timerHandle);
        }
    }

    disable() {
        this._timeouts.forEach(id => GLib.Source.remove(id));
        this._timeouts = [];

        this._menu.destroy();
        this._menu = null;

        this._indicator.destroy();
        this._indicator = null;

        this._tailscale.destroy();
        this._tailscale = null;
    }
}
