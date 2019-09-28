class YtPlayer
{
  
  constructor()
  {
    this.ready = false;
    this.refreshState_bound = this.refreshState.bind(this);
    this.refreshStateEnabled = true;
    this.lastSync = 0;
    this.player = new YT.Player('player', {
      height: '1920',
      width: '1080',
      // videoId: 'M7lc1UVf-VE',
      playerVars: {
        controls: 0,
        disablekb: 1, // todo: Add custom controls
        rel: 0,
      },
      events: {
        'onReady': this.onReady.bind(this),
        'onStateChange': this.onStateChange.bind(this),
        'onPlaybackRateChange': this.onPlaybackRateChange.bind(this),
        'onPlaybackQualityChange': this.onPlaybackQualityChange.bind(this),
        'onError': this.onError.bind(this)
      }
    });
  }
  
  waitReady()
  {
    var self = this;
    return new Promise(function(resolve) {
      if (self.ready) resolve();
      else
      {
        function handler()
        {
          unsubYoutube('onReady', handler);
          resolve();
        }
        self.player.addEventListener('onReady', handler);
      }
    });
  }
  
  // _promise_state(state)
  // {
  //   if (typeof(state) == "number") state = [state];
  //   return new Promise(function(resolve, reject) {
      
  //   })
  // }
  
  loadVideo(id, startSeconds = 0)
  {
    id = parseVideoUrl(id);
    this.loadingVideo = true;
    var self = this;
    vm.player.video = id;
    return new Promise(function(resolve, reject) {
      var handler = function(e) {
        vm.player.state = e.data;
        if (e.data == YT.PlayerState.PLAYING)
        {
          var d = self.player.getVideoData();
          if (vm.net.roomId && d.author)
          {
            updateRoomMeta(vm.net.roomId, d.author + " - " + d.title);
          }
          // Will break
          unsubYoutube('onStateChange', handler);
          self.pauseVideo();
          self.setVolume(vm.local.volume);
          self.loadingVideo = false;
          self.refreshBaseMetadata();
          self.onStateChange(e);
          resolve();
        }
      }
      self.player.addEventListener('onStateChange', handler);
      self.player.loadVideoById(id, startSeconds);
      self.player.setVolume(0);
    })
  }
  
  seekTo(position, allowSmart = false)
  {
    if (allowSmart && vm.ui.smartSeek && Math.abs(this.player.getCurrentTime() - position) < 0.3)
    {
      return;
    }
    this.player.seekTo(position, true);
  }
  
  setQuality(q)
  {
    this.player.setPlaybackQuality(q);
  }
  
  setSpeed(s)
  {
    this.player.setPlaybackRate(s);
  }
  
  setVolume(vol)
  {
    this.player.setVolume(vol);
  }
  
  playVideo()
  {
    // console.log(new Error("Play check"));
    this.player.playVideo();
  }
  
  pauseVideo()
  {
    // console.log(new Error("Pause check"));
    this.player.pauseVideo();
  }
  
  onReady(e)
  {
    this.ready = true;
    this.refreshBaseMetadata();
    requestAnimationFrameUnique(this.refreshState_bound);
  }
  
  onStateChange(e)
  {
    if (this.loadingVideo) return; // Ignore
    
    const oldState = vm.player.state;
    let state = vm.player.state = e.data;
    
    const PS = YT.PlayerState;
    peer.send_sync(vm.player.position, vm.player.state);
    const names = {
      "3": "BUFFERING",
      "5": "CUED",
      "0": "ENDED",
      "2": "PAUSED",
      "1": "PLAYING",
      "-1": "UNSTARTED"
    };
    if (oldState != state)
    {
      // console.log("STATE: " + names[oldState] + " -> " + names[state]);
      if ((oldState == PS.BUFFERING || oldState == PS.PLAYING) && state == PS.PAUSED)
      {
        // console.log("PAUSE", names[oldState], names[state]);
        peer.send_pause(oldState == PS.PLAYING ? this.player.getCurrentTime() : null);
        vm.player.paused = true;
      }
      else if ((oldState != PS.PLAYING && oldState != PS.BUFFERING) && (state == PS.PLAYING))
      {
        // console.log("PLAY", names[oldState], names[state]);
        peer.send_play(oldState == PS.PAUSED ? this.player.getCurrentTime() : null);
        vm.player.paused = false;
      }
    }
    vm.session.countPause = state == YT.PlayerState.PAUSED || state == YT.PlayerState.ENDED;
  }
  
  refreshState()
  {
    if (this.refreshStateEnabled && !this.loadingVideo)
    {
      var old = vm.player.position;
      vm.local.buffered = this.player.getVideoLoadedFraction();
      vm.player.position = this.player.getCurrentTime();
      vm.player.duration = this.player.getDuration();
      var diff = vm.player.position - old;
      // Incrememnt only if natural playback and not seek
      if (diff < 0.3 && diff > 0)
      {
        for (var u of vm.users)
        {
          if (u.state == YT.PlayerState.PLAYING) u.position += diff;
        }
      }
      if (Math.abs(this.lastSync - vm.player.position) > 10)
      {
        peer.send_sync(vm.player.position, vm.player.state);
        this.lastSync = vm.player.position;
      }
    }
    requestAnimationFrameUnique(this.refreshState_bound);
  }
  
  refreshBaseMetadata()
  {
    vm.player.speed = this.player.getPlaybackRate();
    vm.player.speeds = this.player.getAvailablePlaybackRates();
    vm.player.quality = this.player.getPlaybackQuality().concat();
    vm.player.qualities = this.player.getAvailableQualityLevels().concat();
  }
  
  onError(e)
  {
    const errors = {
      "2": "Invalid video ID.",
      "5": "Video is so old it requires flash to play (HTML5 video error).",
      "100": "Video was not found. (removed/marked private)",
      "101": "Blocked to view in embedded players",
      "150": "Blocked to view in embedded players?"
    }
    vm.error = "YouTube Error [" + e.data + "]: " + (errors[e.data]) || "Unknown error";
  }
  
  onPlaybackRateChange(e)
  {
    vm.player.speed = e.data;
    vm.player.speeds = this.player.getAvailablePlaybackRates().concat();
  }
  
  onPlaybackQualityChange(e)
  {
    vm.player.quality = e.data;
    vm.player.qualities = this.player.getAvailableQualityLevels().concat();
  }
  
}