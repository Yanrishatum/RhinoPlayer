


class Conn
{
  
  constructor()
  {
    this.peer = null;
    this.id = null;
    this.user = null;
    this.connections = [];
  }
  
  init(id)
  {
    this.destroy();
    let peer = this.peer = new Peer(id);
    peer.on('error', this.onErr.bind(this, "Peer"));
    peer.on('disconnected', function ()
    {
      // console.warn("PeerJS: Disconnected");
      peer.id = this.id;
      peer._lastServerId = this.id;
      peer.reconnect();
    });
    peer.on('connection', this.onJoin.bind(this));
    var self = this;
    return new Promise(function (resolve, reject)
    {
      peer.on('open', function (id)
      {
        self.connected = true;
        vm.net.id = id;
        self.id = id;
        self.user = self.makeUserMeta(id, vm.net.uid, vm.net.name, true);
        vm.users.push(self.user);
        resolve(id);
      });
    });
  }
  
  makeUserMeta(id, uid, name, self, conn)
  {
    for (var u of this.connections)
    {
      if (u.uid == uid)
      {
        u.id = id;
        u.name = name;
        u.self = self;
        u.conn = conn;
        return u;
      }
    }
    return {
      id: id,
      uid: uid,
      name: name,
      self: self,
      conn: conn,
      state: -1,
      position: 0,
    };
  }
  
  destroy()
  {
    if (this.peer)
    {
      this.peer.destroy();
      this.connected = false;
    }
  }
  
  connect(id)
  {
    var conn = this.peer.connect(id, {
      reliable: true, metadata: {
        name: vm.net.name,
        password: vm.net.password,
        uid: vm.net.uid,
        mesh: this.connections.length == 0,
      }
    });
    var self = this;
    return new Promise(function(res, rej) {
      conn.on('open', function ()
      {
        // console.log("CONNECT/OPEN: " + id);
        res(true);
      });
      conn.on('close', function ()
      {
        // logError("PeerJS", "Connection got closed. Wrong password?");
        // res(false);
        // console.log("CONNECT/CLOSE: " + id);
      });
      conn.on('data', self.handleMessage.bind(self, conn));
      conn.on('error', self.onErr.bind(self, "Connection"));
      let unavailableCheck = function(err)
      {
        if (err.type == "peer-unavailable" && err.message.substr(26) == id)
        {
          res(false);
          self.peer.removeListener('error', unavailableCheck);
        }
      }
      self.peer.on('error', unavailableCheck);
    });
  }
  
  onJoin(conn)
  {
    var rejoin = false;
    for (var c of this.connections)
    {
      if (c.uid == conn.metadata.uid)
      {
        rejoin = true;
        break;
      }
    }
    if (!rejoin && vm.net.password && conn.metadata.password != vm.net.password)
    {
      // Refuse connection on passworded.
      conn.close();
      return;
    }
    var meta = conn.metadata;
    var user = this.makeUserMeta(conn.peer, meta.uid, meta.name, false, conn);
    var self = this;
    conn.on('open', function ()
    {
      user.conn = conn;
      conn.send(self.prepareMessage("handshake", {
        name: vm.net.name,
        uid: vm.net.uid,
      }));
      if (meta.mesh)
      {
        var mesh = {};
        for (var u of self.connections)
        {
          if (u.uid != user.uid) mesh[u.uid] = u.id;
        }
        conn.send(self.prepareMessage("init", {
          logs: vm.logs,
          player: vm.player,
          room: vm.net.roomId,
          mesh: mesh
        }));
        
      }
      if (!rejoin)
      {
        self.connections.push(user);
        vm.users.push(user);
        self.send_log(prepareLog("info", "User " + user.name + " connected"));
      }
      if (meta.mesh)
      {
        if (vm.net.roomId)
        {
          updateRoomMesh(vm.net.roomId, self.connections);
        }
      }
    });
    conn.on('close', function ()
    {
      // In case user reconnected during grace period.
      if (user.conn == conn)
      {
        user.conn = null;
        self.connections.splice(self.connections.indexOf(user), 1);
        vm.users.splice(vm.users.indexOf(user), 1);
        self.send_log(prepareLog("info", "User " + user.name + " disconnected", { kind: "disconnect", user: user.uid }));
      }
    });
    conn.on('data', this.handleMessage.bind(this, conn));
    conn.on('error', this.onErr.bind(this, "Connection[" + conn.metadata.name + "]"));
    
  }
  
  onErr(label, err)
  {
    logError(label, err);
  }
  
  handleMessage(conn, data)
  {
    // console.log(data);
    var cb = this[ "api_" + data.method ];
    var user = null;
    for (var u of this.connections) if (u.uid == data.sender)
    {
      user = u;
      break;
    }
    if (!user && !conn) user = this.user;
    if (cb)
    {
      cb.call(this, user, data.payload, conn);
    }
  }
  
  broadcast(message, handleSelf = false)
  {
    for (var u of this.connections)
    {
      if (u.conn) u.conn.send(message);
    }
    if (handleSelf)
      this.handleMessage(null, message);
  }
  
  prepareMessage(method, payload)
  {
    return { method: method, sender: this.user.uid, payload: payload, timestamp: Date.now() };
  }
  
  broadcastMessage(method, payload, handleSelf = true)
  {
    // console.log(method, payload);
    this.broadcast(this.prepareMessage(method, payload), handleSelf);
  }
  
  // API
  
  api_handshake(user, payload, conn)
  {
    if (!conn) return; // Don't apply to self.
    var user = this.makeUserMeta(conn.peer, payload.uid, payload.name, false, conn)
    this.connections.push(user);
    vm.users.push(user);
  }
  
  api_init(user, payload, conn)
  {
    var connects = [];
    for (var [uid,id] of Object.entries(payload.mesh)) connects.push(this.connect(id));
    // Promise.all(connects).then()
    vm.logs = payload.logs;
    vm.net.roomId = payload.room;
    // vm.player = payload.player;
    var p = payload.player;
    player.loadVideo(p.video, p.position).then(function() {
      player.setQuality(p.quality);
      player.setSpeed(p.speed);
      if (p.paused) player.pauseVideo();
      else player.playVideo();
    });
  }
  
  api_sync(user, payload, conn)
  {
    user.position = payload.position;
    user.state = payload.state;
  }
  
  send_sync(position, state)
  {
    this.broadcastMessage("sync", { position: position, state: state }, false);
  }
  
  api_log(user, payload, conn)
  {
    if (payload.kind == "disconnect")
    {
      var uid = payload.user;
      var last = vm.logs[vm.logs.length - 1];
      if (last.kind == "disconnect" && last.user == uid) return; // Skip adding it - duplicate.
    }
    vm.logs.push(payload);
  }
  
  send_log(payload)
  {
    this.broadcastMessage("log", payload);
  }
  
  api_pause(user, payload, conn)
  {
    player.pauseVideo();
    if (payload && (payload.position || payload.position === 0)) player.seekTo(payload.position, true);
  }
  
  send_pause(position)
  {
    this.broadcastMessage("pause", { position: position }, false);
  }
  
  api_play(user, payload, conn)
  {
    if (payload && (payload.position || payload.position === 0)) player.seekTo(payload.position, true);
    player.playVideo();
  }
  
  send_play(position)
  {
    this.broadcastMessage("play", { position: position }, false);
  }
  
  api_seek(user, payload, conn)
  {
    if (!player.target || payload.target == this.user.uid)
      player.seekTo(payload.position);
  }
  
  send_seek(p, user = null)
  {
    this.broadcastMessage("seek", { target: user, position: p });
  }
  
  api_video(user, payload, conn)
  {
    player.loadVideo(payload.url, payload.position).then(function() {
      if (payload.state)
      {
        // TODO
      }
    });
  }
  
  send_video(url, state)
  {
    this.broadcastMessage("video", { url: url, state: state });
  }
  
  api_speed(user, payload, conn)
  {
    player.setSpeed(payload.speed);
  }
  
  send_speed(s)
  {
    this.broadcastMessage("speed", { speed: s });
  }
  
  api_quality(user, payload, conn)
  {
    player.setQuality(payload.quality);
  }
  
  send_quality(q)
  {
    this.broadcastMessage("quality", { quality: q });
  }
}