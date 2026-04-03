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
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';

// This is the live instance of the Quick Settings menu
const QuickSettingsMenu = Main.panel.statusArea.quickSettings;

import {Tailscale} from './tailscale.js';
import {filterMullvadNodes, createMullvadExitNodeButton} from './mullvad.js';

const KEYBINDING_TOGGLE = 'toggle-tailscale';

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

          this.connect('clicked', () => {
              tailscale.exit_node = '';
              this.reactive = false;
          });
      }
  }
);

const TailscaleIndicator = GObject.registerClass(
  class TailscaleIndicator extends QuickSettings.SystemIndicator {
      _init(icon, tailscale) {
          super._init();

          // Create the icon for the indicator
          const up = this._addIndicator();
          up.gicon = icon;
          tailscale.bind_property('running', up, 'visible', GObject.BindingFlags.SYNC_CREATE | GObject.BindingFlags.DEFAULT);

          // Create the icon for the indicator
          const exit = this._addIndicator();
          exit.icon_name = 'network-vpn-symbolic';
          const setVisible = () => {
              exit.visible = tailscale.running && tailscale.exit_node !== '';
          };
          tailscale.connect('notify::exit-node', () => setVisible());
          tailscale.connect('notify::running', () => setVisible());
          setVisible();
      }
  }
);

