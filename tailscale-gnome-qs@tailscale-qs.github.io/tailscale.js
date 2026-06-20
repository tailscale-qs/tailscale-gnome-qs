import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup';

class TailscaleApiClient {
    constructor() {
        const address = new Gio.UnixSocketAddress({
            path: '/var/run/tailscale/tailscaled.sock',
        });
        this.session = new Soup.Session({
            'remote-connectable': address,
            'timeout': 0,
            'idle-timeout': 0,
        });
        this.encoder = new TextEncoder();
        this.decoder = new TextDecoder();
    }

    async* stream(method, path, cancellable) {
        const message = Soup.Message.new(method, `http://local-tailscaled.sock${path}`);

        const baseStream = this.session.send(message, null);
        const stream = new Gio.DataInputStream({base_stream: baseStream});
        try {
            const contentType = message.response_headers.get_one('Content-Type');
            while (true) {
                Gio._promisify(Gio.DataInputStream.prototype, 'read_line_async');
                // eslint-disable-next-line no-await-in-loop
                const [_response, length] = await stream.read_line_async(GLib.PRIORITY_DEFAULT, cancellable);
                if (length === 0)
                    break;

                const response = this.decoder.decode(_response);
                yield contentType === 'application/json' ? JSON.parse(response) : response;
            }
        } finally {
            stream.close(null);
        }
    }

    async request(method, path, body = null) {
        const message = Soup.Message.new(method, `http://local-tailscaled.sock${path}`);
        if (body) {
            const bytes = this.encoder.encode(JSON.stringify(body));
            message.set_request_body_from_bytes('application/json', new GLib.Bytes(bytes));
        }

        Gio._promisify(Soup.Session.prototype, 'send_and_read_async');
        const responseBytes = await this.session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
        const response = this.decoder.decode(responseBytes.get_data());
        const contentType = message.response_headers.get_one('Content-Type');
        return contentType === 'application/json' ? JSON.parse(response) : response;
    }

    destroy() {
        this.session.abort();
        this.session = null;
        this.encoder = null;
        this.decoder = null;
    }
}

export const Tailscale = GObject.registerClass(
    {
        Properties: {
            'running': GObject.ParamSpec.boolean(
                'running', '', '',
                GObject.ParamFlags.READWRITE,
                false
            ),
            'accept-dns': GObject.ParamSpec.boolean(
                'accept-dns', '', '',
                GObject.ParamFlags.READWRITE,
                false
            ),
            'accept-routes': GObject.ParamSpec.boolean(
                'accept-routes', '', '',
                GObject.ParamFlags.READWRITE,
                false
            ),
            'allow-lan-access': GObject.ParamSpec.boolean(
                'allow-lan-access', '', '',
                GObject.ParamFlags.READWRITE,
                false
            ),
            'shields-up': GObject.ParamSpec.boolean(
                'shields-up', '', '',
                GObject.ParamFlags.READWRITE,
                false
            ),
            'ssh': GObject.ParamSpec.boolean(
                'ssh', '', '',
                GObject.ParamFlags.READWRITE,
                false
            ),
            'exit-node': GObject.ParamSpec.string(
                'exit-node', '', '',
                GObject.ParamFlags.READWRITE,
                ''
            ),
            'exit-node-name': GObject.ParamSpec.string(
                'exit-node-name', '', '',
                GObject.ParamFlags.READABLE,
                ''
            ),
            'nodes': GObject.ParamSpec.jsobject(
                'nodes', '', '',
                GObject.ParamFlags.READABLE,
                {}
            ),
            'selfNode': GObject.ParamSpec.jsobject(
                'selfNode', '', '',
                GObject.ParamFlags.READABLE,
                {}
            ),
            'profiles': GObject.ParamSpec.jsobject(
                'profiles', '', '',
                GObject.ParamFlags.READABLE,
                []
            ),
        },
    },
    class Tailscale extends GObject.Object {
        _init() {
            super._init();
            this._client = new TailscaleApiClient();
            this._running = false;
            this._dns = false;
            this._routes = false;
            this._allowLanAccess = false;
            this._shields_up = false;
            this._ssh = false;
            this._exitNode = '';
            this._exitNodeName = null;
            this._nodes = {};
            this._selfNode = {};
            this._profiles = [];
            this._cancelable = new Gio.Cancellable();
            this._timeouts = [];
            this._listen();
        }

        destroy() {
            this._cancelable.cancel();
            this._cancelable = null;
            this._client.destroy();
            this._client = null;
            this._timeouts.forEach(id => GLib.Source.remove(id));
            this._timeouts = [];
        }

        _processRunning(prefs) {
            const running = prefs.WantRunning;
            if (running !== this._running) {
                this._running = running;
                this.notify('running');
            }
        }

        _detectedAnyNodeDifference(left, right) {
            return (left?.name !== right?.name) ||
        (left?.os !== right?.os) ||
        (left?.exit_node !== right?.exit_node) ||
        (left?.exit_node_option !== right?.exit_node_option) ||
        (left?.online !== right?.online) ||
        (left?.ips.length !== right?.ips.length || left?.ips.some((v, i) => v !== right?.ips[i])) ||
        (left?.mullvad !== right?.mullvad) ||
        (left?.location !== right?.location);
        }

        _processNodes(prefs, peers) {
            let anyFoundNodeChanged = false;
            const nodes = peers.map(peer => {
                const node = {
                    id: peer.ID,
                    name: peer.DNSName.split('.')[0],
                    os: peer.OS,
                    exit_node: peer.ID === prefs.ExitNodeID,
                    exit_node_option: peer.ExitNodeOption,
                    online: peer.Online,
                    ips: peer.TailscaleIPs,
                    mullvad: peer.Tags?.includes('tag:mullvad-exit-node') || false,
                    location: peer.Location,
                };
                if (!anyFoundNodeChanged) {
                    const oldNode = this._nodes[node.id];
                    anyFoundNodeChanged = !oldNode || this._detectedAnyNodeDifference(oldNode, node);
                }
                return node;
            }).reduce((acc, nod) => {
                acc[nod.id] = nod;
                return acc;
            }, {});

            if (anyFoundNodeChanged) {
                this._nodes = nodes;
                this.notify('nodes');
                return;
            }

            const oldSet = new Set(Object.keys(this._nodes));
            const newSet = new Set(Object.keys(nodes));
            if (oldSet.size !== newSet.size) {
                this._nodes = nodes;
                this.notify('nodes');
                return;
            }

            if (oldSet.symmetricDifference(newSet).size !== 0) {
                this._nodes = nodes;
                this.notify('nodes');
            }
        }

        _processExitNode(prefs) {
            const exitNodeId = prefs.ExitNodeID;
            if (exitNodeId !== this._exitNode) {
                this._exitNode = exitNodeId;
                this.notify('exit-node');
                const exitNodePeer = this._peers.find(peer => peer.ID === exitNodeId);
                this._exitNodeName = exitNodePeer ? exitNodePeer.DNSName.split('.')[0] : null;
                this.notify('exit-node-name');
            }
        }

        _processDns(prefs) {
            const acceptDns = prefs.CorpDNS;
            if (acceptDns !== this._dns) {
                this._dns = acceptDns;
                this.notify('accept-dns');
            }
        }

        _processRoutes(prefs) {
            const acceptRoutes = prefs.RouteAll;
            if (acceptRoutes !== this._routes) {
                this._routes = acceptRoutes;
                this.notify('accept-routes');
            }
        }

        _processLan(prefs) {
            const allowLanAccess = prefs.ExitNodeAllowLANAccess;
            if (allowLanAccess !== this._allowLanAccess) {
                this._allowLanAccess = allowLanAccess;
                this.notify('allow-lan-access');
            }
        }

        _processShields(prefs) {
            const shieldsUp = prefs.ShieldsUp;
            if (shieldsUp !== this._shields_up) {
                this._shields_up = shieldsUp;
                this.notify('shields-up');
            }
        }

        _processSsh(prefs) {
            const ssh = prefs.RunSSH;
            if (ssh !== this._ssh) {
                this._ssh = ssh;
                this.notify('ssh');
            }
        }

        get running() {
            return this._running;
        }

        set running(value) {
            if (this.running === value)
                return;

            this._updatePrefs({WantRunning: value});
        }

        get accept_dns() {
            return this._dns;
        }

        set accept_dns(value) {
            if (this.accept_dns === value)
                return;

            this._updatePrefs({CorpDNS: value});
        }

        get accept_routes() {
            return this._routes;
        }

        set accept_routes(value) {
            if (this.accept_routes === value)
                return;

            this._updatePrefs({RouteAll: value});
        }

        get allow_lan_access() {
            return this._allowLanAccess;
        }

        set allow_lan_access(value) {
            if (this.allow_lan_access === value)
                return;

            this._updatePrefs({ExitNodeAllowLANAccess: value});
        }

        get shields_up() {
            return this._shields_up;
        }

        set shields_up(value) {
            if (this.shields_up === value)
                return;

            this._updatePrefs({ShieldsUp: value});
        }

        get ssh() {
            return this._ssh;
        }

        set ssh(value) {
            if (this.ssh === value)
                return;

            this._updatePrefs({RunSSH: value});
        }

        get exit_node() {
            return this._exitNode;
        }

        set exit_node(value) {
            if (this.exit_node === value)
                return;

            this._updatePrefs({ExitNodeID: value});
        }

        get exit_node_name() {
            return this._exitNodeName;
        }

        get nodes() {
            return this._nodes;
        }

        get selfNode() {
            return this._selfNode;
        }

        get profiles() {
            return this._profiles;
        }

        set profiles(value) {
            this._updateProfile(value);
        }

        async _listen() {
            const delayPromise = delay => new Promise(resolve => {
                const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                    const index = this._timeouts.indexOf(id);
                    if (index > -1)
                        this._timeouts.splice(index, 1);
                    resolve();
                    return GLib.SOURCE_REMOVE;
                });
                this._timeouts.push(id);
            });

            while (true) {
                try {
                    // eslint-disable-next-line no-await-in-loop
                    const status = await this._client.request('GET', '/localapi/v0/status');
                    this._peers = Object.values(status.Peer || {});
                    this._selfNode = status.Self || {};
                    // eslint-disable-next-line no-await-in-loop
                    this._prefs = await this._client.request('GET', '/localapi/v0/prefs');
                    // eslint-disable-next-line no-await-in-loop
                    this._profiles = await this._client.request('GET', '/localapi/v0/profiles/');
                    this.notify('profiles');
                    this._parseResponse();

                    // eslint-disable-next-line no-await-in-loop
                    for await (const update of this._client.stream('GET', '/localapi/v0/watch-ipn-bus', this._cancelable)) {
                        let shouldUpdate = false;
                        if (update.Prefs) {
                            this._prefs = update.Prefs;
                            shouldUpdate = true;
                        }
                        if (update.NetMap) {
                            this._peers = update.NetMap.Peers.map(peer => ({
                                ID: peer.StableID,
                                DNSName: peer.Name,
                                OS: peer.Hostinfo.OS,
                                ExitNodeOption: peer.AllowedIPs?.includes('0.0.0.0/0'),
                                Online: peer.Online,
                                TailscaleIPs: peer.Addresses.map(address => address.split('/')[0]),
                                Tags: peer.Tags,
                                Location: peer.Hostinfo.Location,
                            }));
                            shouldUpdate = true;
                        }
                        if (shouldUpdate)
                            this._parseResponse();
                    }
                } catch (error) {
                    if (this._cancelable.is_cancelled())
                        break;

                    console.error(error);
                    this._processRunning({WantRunning: false});
                }
                // eslint-disable-next-line no-await-in-loop
                await delayPromise(5000);
            }
        }

        _parseResponse() {
            if (this._prefs) {
                this._processRunning(this._prefs);
                this._processDns(this._prefs);
                this._processRoutes(this._prefs);
                this._processLan(this._prefs);
                this._processShields(this._prefs);
                this._processSsh(this._prefs);
                this._processExitNode(this._prefs);
                if (this._peers)
                    this._processNodes(this._prefs, this._peers);
            }
        }

        _updatePrefs(prefUpdatePartial) {
            const body = {
                ...prefUpdatePartial,
                ...Object.fromEntries(
                    Object.entries(prefUpdatePartial)
            .map(([key, _]) => [`${key}set`, true])
                ),
            };
            this._client.request('PATCH', '/localapi/v0/prefs', body)
        .then(
            prefs => {
                this._prefs = prefs;
                this._parseResponse();
            },
            error => console.error(error)
        );
        }

        _updateProfile(value) {
            this._client.request('POST', `/localapi/v0/profiles/${value}`, {})
        .then(
            () => {
                this.notify('profiles');
            },
            error => console.error(error)
        );
        }
    }
);
