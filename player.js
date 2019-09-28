/** @type {YtPlayer} */
var player;

var lastPauseTS = 0;
function refreshPausedTime(ts)
{
  if (vm.session.countPause)
  {
    vm.session.pausedTime += (ts - lastPauseTS) / 1000;
  }
  lastPauseTS = ts;
  requestAnimationFrame(refreshPausedTime);
}
requestAnimationFrame(refreshPausedTime);

function setVolume(vol)
{
  // var v = vol / 100;
  // player.setVolume(Math.ceil(v * v * 100));
  player.setVolume(Math.ceil(vol));
}

// Sync player state to content.
var progress = $("#progress");
var playerContainer = $("#player-container");

var users = {};
var localUser = null;
/** @type {Conn} */
var peer;
var hostConn;

// TODO: Actually do a p2p connectivity instead of centralized host?

function destroyPeer()
{
  if (peer) peer.destroy();
}
function initPeer()
{
  if (!peer) peer = new Conn();
  saveStorage();
  return peer.init();
}

//

var storage = localStorage.getItem("settings");
var defStorage = {
  name: "Rhino Farmer #" + (((Math.random() * 999) | 0) + 1),
  uid: randomString()
};
if (storage) storage = Object.assign(defStorage, JSON.parse(storage));
else storage = defStorage;
function saveStorage()
{
  localStorage.setItem("settings", JSON.stringify({
    name: vm.net.name,
    uid: vm.net.uid
  }));
}

var vmData = {
  // Networked
  state: 0,
  net: {
    connected: false,
    name: storage.name,
    password: "",
    hashed: "",
    id: null,
    peer: null,
    uid: storage.uid,
    roomId: null,
    globalPaused: false,
  },
  logs: [],
  users: [],
  // Player state
  player: {
    video: "",
    state: -1,
    paused: true,
    position: 0,
    duration: 0,
    quality: "",
    speed: 1,
  },
  // Global session state
  session: {
    pausedTime: 0,
    countPause: false,
  },
  // Local player data
  local: {
    autosync: false,
    mute: false,
    volume: 100,
    buffered: 0,
    qualities: [],
    speeds: [ 0.25, 0.5, 1, 1.5, 2, 2.5 ],
  },
  // UI info
  ui: {
    // Menu pop-ups. 10/10 solution btw
    toggles: {
      settings: false,
      quality: false,
      speed: false,
    },
    popups: {
      playVideo: false,
    },
    // At which time diff it's considered a desync.
    desyncTreshold: 1,
    // Show position offset relative to current playback
    showPosition: false,
    smartSeek: true,
    position: 0, // 0...1
    dragMode: false, // Currently draggin timer
    fullscreen: false,
    sessionInput: location.hash != "" ? location.hash.substr(1) : "",
    videoInput: "",
    passwordInput: "",
    privateLobby: false,
  },
  rooms: null,
  error: null,
};
/** @type {vmData} */
var vm = new Vue({
  el: "#app",
  data: vmData,
  computed: {
    volumeIcon: function ()
    {
      if (this.local.mute || this.local.volume == 0) return 'icon-volume-off';
      else if (this.local.volume <= 33) return 'icon-volume-down';
      else if (this.local.volume <= 66) return 'icon-volume';
      else return 'icon-volume-up';
    },
    stateIcon: function ()
    {
      return this.getStateIcon(this.player.state);
    },
    videoBuffered: function ()
    {
      return (this.player.buffered * 100) + "%";
    },
    videoPosition: function ()
    {
      if (this.player.position == 0 || this.player.duration == 0) return "0";
      if (this.ui.dragMode) return (this.ui.position * 100) + "%";
      return (this.player.position / this.player.duration * 100) + "%";
    },
    progressPosition: function ()
    {
      return this.getTimeDiff(this.player.position, this.ui.position * this.player.duration);
    },
    volumePadded: function ()
    {
      return this.local.volume.toString().padStart(3, "\xa0");
    }
  },
  watch: {
    "local.volume": function (v)
    {
      setVolume(v);
    },
    "local.mute": function (v)
    {
      if (v) player.player.mute();
      else player.player.unMute();
    }
  },
  methods: {
    // Utility
    humanTime: function (time, fract = false)
    {
      time |= 0;
      if (time === 0) return fract ? "0:00:00.00" : "0:00:00";
      var res = ((time / 3600) | 0).toString() + ":" +
        (((time % 3600) / 60) | 0).toString().padStart(2, "0") + ":" +
        ((time % 60) | 0).toString().padStart(2, "0");
      return fract ? res + "." + (Math.round(time - Math.floor(time) * 100) / 100).toString().padStart(2, "0") : res;
    },
    showMenu: function (chain)
    {
      var shown = [];
      for (var k in this.ui.toggles) if (this.ui.toggles[ k ] == true) shown.push(k);
      var names = chain.split(",");
      if (shown.length == names.length)
      {
        for (var i = 0; i < shown.length; i++) if (shown[ i ] == names[ i ]) break;
        if (i != shown.length) names.pop();
      }
      for (var k in this.ui.toggles)
      {
        if (k.charAt(0) != "_")
          Vue.set(this.ui.toggles, k, names.indexOf(k) != -1);
      }
    },
    videoQuality: function (quality)
    {
      return { "small": "240p", "medium": "360p", "large": "480p", "hd720": "720p", "hd1080": "1080p" }[ quality ] || quality;
    },
    // UI
    updatePosition: function(event)
    {
      vm.ui.position = event.offsetX / event.currentTarget.offsetWidth;
    },
    updateDrag: function (event)
    {
      if (vm.ui.dragMode)
        vm.ui.position = (event.offsetX + progress.offsetX - event.currentTarget.offsetX) / progress.offsetWidth;
    },
    // Callbacks
    setSpeed: function (s)
    {
      this.showMenu("settings");
      peer.send_speed(s);
    },
    setQuality: function (q)
    {
      this.showMenu("settings");
      peer.send_quality(q);
    },
    stopDrag: function()
    {
      if (vm.ui.dragMode)
      {
        vm.ui.dragMode = false;
        peer.send_seek(vm.ui.position * vm.player.duration);
      }
    },
    togglePlay: function ()
    {
      if (vm.player.paused) player.playVideo();
      else player.pauseVideo();
    },
    getStateIcon: function (state)
    {
      // if (this.player == 0) return [ 'icon-stop' ];
      if (state < 2 || state == 5) return [ 'icon-play' ];
      if (state == 2) return [ 'icon-pause' ];
      if (state == 3) return [ 'icon-spin', 'animate-spin' ];
      return [ 'icon-link' ];
    },
    getTimeDiff: function (ref, time)
    {
      if (this.player.duration == 0) return "0:00:00/+00.000";
      var diff = time - ref;
      var pref = diff > 0 ? "/+" : "/-";
      diff = Math.abs(diff);
      var h = (diff / 3600) | 0;
      var m = ((diff % 3600) / 60) | 0;
      var s = (diff % 60) | 0;
      var fract = diff - (diff | 0);
      return this.humanTime(time) + pref + (h != 0 ? (h + ":") : "") + (m != 0 ? (m + ":") : "") + s.toString().padStart(2, "0") + '.' + Math.round(fract * 1000);
    },
    desyncCheck: function (user)
    {
      if (user.uid != this.net.uid && Math.abs(user.position - this.player.position) > this.ui.desyncTreshold)
      {
        return ["desync"]
      }
      return [];
    },
    toggleFullscreen: function (event)
    {
      if (!this.ui.fullscreen)
      {
        document.documentElement.requestFullscreen();
      }
      else
      {
        document.exitFullscreen();
      }
    },
    // Click on "sync to me" button
    syncUser: function (pos)
    {
      player.seekTo(pos);
    },
    
    joinClick: function ()
    {
      if (peer != null) return;
      var idx = this.ui.sessionId.indexOf("#");
      if (idx != -1)
      {
        this.ui.sessionId = this.ui.sessionId.substr(idx + 1);
      }
      initPeer().then(() => connectPeer(this.ui.sessionId));
    },
    // Popup handlers
    popupLabel: function(id)
    {
      // 1: Host
      // 2: Join
      // 3: Play video (in session)
      // 4: 
      return {
        "header": ["", "Host room", "Join room", "Play video"],
        "okButton": ["", "Host", "Join", "Play"],
        "showPass": [false, true, true, false],
        "showUrl": [false, true, false, true],
        "showSession": [false, true, true, false],
        "session": ["", "Room name", "Room ID", ""],
        // "showClose": [true, true, true, true],
      }[id][this.ui.popups.playVideo];
    },
    showPopup: function(state)
    {
      switch(state)
      {
        case 1:
          vm.ui.sessionInput = vm.net.name + "'s room";
          vm.ui.passwordInput = "";
          vm.ui.videoInput = "";
          break;
        case 2:
          vm.ui.sessionInput = vm.net.roomId;
          vm.ui.passwordInput = "";
          break;
        case 3:
          vm.ui.videoInput = "";
          break;
      }
      vm.ui.popups.playVideo = state;
      requestAnimationFrame(function() {
        switch(state)
        {
          case 1: $("#sessionId").focus(); break;
          case 2: $("#password").focus(); break;
          case 3: $("#videoId").focus(); break;
        }
      });
    },
    popupNext: function(event)
    {
      if (event.code == "Enter")
      {
        const list = Array.from($$("#sessionPopup div:not(*[style*='display: none;'])>input:not(#privateCheck)"));
        const idx = list.indexOf(event.currentTarget);
        if (idx + 1 >= list.length) this.popupConfirm();
        else list[idx+1].focus();
      }
    },
    // Popup clicks
    joinRoom: function (room)
    {
      vm.room = room;
      vm.net.roomId = room.id;
      if (room.password_protected)
      {
        vm.state = STATE_JOIN;
        vm.showPopup(2);
      }
      else
      {
        this.joinRoomInfo(room.id, null);
      }
    },
    joinRoomInfo: async function(id, pass)
    {
      var roomInfo = await tryJoinRoom(id, pass);
      if (roomInfo.error)
      {
        vm.error = roomInfo.error;
        vm.state = STATE_INIT;
        getRoomList();
        return;
      }
      vm.net.password = pass;
      vm.state = STATE_IN_SESSION;
      await initPeer();
      /** @type {Array<[string, string]>} */
      var entries = Object.entries(roomInfo.peers);
      var connected = false;
      do {
        let [k,v] = entries.shift();
        if (k == vm.net.uid) continue;
        if ((connected = await peer.connect(v))) break;
      } while (entries.length);
      if (!connected)
      {
        updateRoomMesh(id, peer.connections);
        vm.setVideoWithLog(roomInfo.url, false);
      }
      vm.updateUrl();
    },
    popupConfirm: async function()
    {
      switch(vm.ui.popups.playVideo)
      {
        case 1: // host
          if (peer && peer.connected)
          {
            if (!confirm("Leave current session?")) return;
          }
          await initPeer();
          var roomId = await createRoom(vm.ui.sessionInput || vm.net.name + "'s room", vm.ui.passwordInput, vm.ui.videoInput, vm.ui.privateLobby ? 'private' : 'public');
          if (roomId.error)
          {
            vm.error = roomId.error;
            return;
          }
          vm.state = STATE_IN_SESSION;
          vm.net.password = vm.ui.passwordInput;
          vm.net.roomId = roomId.id;
          var url = vm.ui.videoInput || "https://youtu.be/UVbNB-p_Z9o";
          vm.setVideoWithLog(vm.ui.videoInput, false);
          this.updateUrl();
          break;
        case 2: // join
          this.joinRoomInfo(vm.room.id, vm.ui.passwordInput);
          break;
        case 3: // play
          vm.setVideoWithLog(vm.ui.videoInput, true);
          break;
      }
      vm.ui.popups.playVideo = 0;
    },
    updateUrl: function()
    {
      var u = new URL(location.href);
      u.searchParams.set("room", vm.net.roomId);
      if (vm.net.password) u.searchParams.set("pass", vm.net.password);
      history.replaceState({}, document.title, u.toString());
    },
    setVideoWithLog: function(url, updateRoom = false)
    {
      peer.send_video(url);
      peer.send_log(prepareLog("video", url));
      if (updateRoom && vm.net.roomId) updateRoomVideo(vm.net.roomId, url);
    },
    exitRoom: function()
    {
      if (confirm("Are you sure?"))
      {
        location.search = "";
      }
    }
  }
});

document.addEventListener("fullscreenchange", function (event)
{
  vm.ui.fullscreen = !!document.fullscreenElement;
});

async function initApp()
{
  let url = new URL(location.href);
  if (url.searchParams.has('room'))
  {
    vm.ui.passwordInput = vm.net.password = url.searchParams.get("pass") || "";
    vm.ui.sessionInput = vm.net.roomId = url.searchParams.get("room");
    vm.state = STATE_IN_SESSION;
    vm.joinRoomInfo(vm.net.roomId, vm.net.password);
    // TODO: Autojoin
  }
  else
  {
    vm.state = STATE_INIT;
    getRoomList();
  }
}

// TODO: Hotkeys

function onYouTubeIframeAPIReady() {
  player = new YtPlayer();
  player.waitReady().then(function() {
    initApp();
  });
}

// Youtube init
var tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
// That is weird-ass method btw.
var firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

window.addEventListener('keyup', function(e) {
  if (vm.state != STATE_IN_SESSION) return;
  let idx;
  switch (e.code)
  {
    case "Space":
      vm.togglePlay();
      break;
    case "KeyF":
      vm.toggleFullscreen();
      break;
    case "Minus":
      idx = vm.player.speeds.indexOf(vm.player.speed);
      if (idx > 0) peer.send_speed(vm.player.speeds[idx-1]);
      break;
    case "Equal":
      idx = vm.player.speeds.indexOf(vm.player.speed);
      if (idx < vm.player.speeds.length - 1) peer.send_speed(vm.player.speeds[idx+1]);
      break;
  }
});
window.addEventListener('keydown', function(e) {
  if (vm.state != STATE_IN_SESSION) return;
  switch (e.code)
  {
    case "ArrowDown":
      vm.local.volume -= 5;
      if (vm.local.volume < 0) vm.local.volume = 0;
      break;
    case "ArrowUp":
      vm.local.volume += 5;
      if (vm.local.volume > 100) vm.local.volume = 100;
      break;
  }
})