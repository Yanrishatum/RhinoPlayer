const STATE_INIT = 0;
const STATE_JOIN = 1;
const STATE_IN_SESSION = 2;

function prepareLog(type, message, payload)
{
  payload = payload || {};
  payload.type = type;
  payload.message = message;
  return payload;
}

function logInfo(message)
{
  vm.logs.push(prepareLog("info", message));
}

function logError(label, err)
{
  console.error(label, err);
  console.log(err.type);
  vm.logs.push(prepareLog("error", label + ": " + err.message, { err_type: err.type, label: label }));
}

// function logData(type, message, payload)
// {
//   payload = payload || {};
//   payload.user = localUser.id;
//   payload.message = message;
//   payload.type = type;
//   sendMessage(prepareMessage("log", payload));
// }

function randomString(len = 32)
{
  var s = [];
  while (len-- > 0)
  {
    s.push(((Math.random() * 94) | 0) + 33);
    // s += String.fromCharCode() Math.random()
  }
  return String.fromCharCode.apply(null, s);
}

function $(query)
{
  return document.querySelector(query);
}
function $$(query)
{
  return document.querySelectorAll(query);
}

function unobservedCopy(obj)
{
  if (obj == null) return null;
  if (typeof (obj) == "object")
  {
    if (Array.isArray(obj))
    {
      var a = [];
      for (var i in obj) a[ i ] = unobservedCopy(obj[ i ]);
      return a;
    }
    var copy = {};
    for (var [ k, v ] of Object.entries(obj))
    {
      if (k == "__ob__") continue;
      copy[ k ] = unobservedCopy(v);
    }
    return copy;
  }
  return obj;
}

async function getRoomList()
{
  vm.rooms = null;
  const r = await fetch(new Request('api.php?method=list'));
  var res = await r.json();
  vm.rooms = res;
  return res;
}

async function tryJoinRoom(room, pass)
{
  let url = new URL('./api.php', location.href);
  url.searchParams.append('method', 'join');
  url.searchParams.append('id', room);
  if (pass) url.searchParams.append("password", pass);
  const r = await fetch(new Request(url));
  return await r.json();
}

async function createRoom(name, password, video, type = "public")
{
  let url = new URL('./api.php', location.href);
  url.searchParams.append('method', 'create');
  url.searchParams.append('name', name);
  url.searchParams.append('type', type);
  if (password) url.searchParams.append('password', password);
  url.searchParams.append('id', vm.net.uid);
  url.searchParams.append('peer', peer.id);
  url.searchParams.append('url', video);
  const r = await fetch(new Request(url));
  return await r.json();
}

async function updateRoomMesh(room, users, video)
{
  let url = new URL("./api.php", location.href);
  url.searchParams.append('method', 'update');
  url.searchParams.append('id', room);
  if (video) url.searchParams.append('url', video);
  url.searchParams.append("mesh[]", vm.net.uid + ":::" + peer.id);
  for (let user of users) {
    url.searchParams.append("mesh[]", user.uid + ":::" + user.id);
  }
  const r = await fetch(new Request(url));
  return await r.json();
}
async function updateRoomVideo(room, video)
{
  let url = new URL("./api.php", location.href);
  url.searchParams.append('method', 'update');
  url.searchParams.append('id', room);
  url.searchParams.append('url', video);
  const r = await fetch(new Request(url));
  return await r.json();
}
async function updateRoomMeta(room, meta)
{
  let url = new URL("./api.php", location.href);
  url.searchParams.append('method', 'update');
  url.searchParams.append('id', room);
  url.searchParams.append('meta', meta);
  const r = await fetch(new Request(url));
  return await r.json();
}

function requestAnimationFrameUnique(cb)
{
  cancelAnimationFrame(cb.__handle);
  cb.__handle = requestAnimationFrame(cb);
}
  
function parseVideoUrl(n)
{
  var url;
  try{
    url = new URL(n);
    if (url.pathname == "/watch" && url.host.endsWith("youtube.com")) n = url.searchParams.get("v");
    else if (url.host.endsWith("youtu.be")) n = url.pathname.substr(1);
    else 
    {
      vm.error = "Invalid url: " + n;
    }
  } catch (e) {
    // vm.error = "Invalid url: " + n;
  }
  return n;
}

// I swear to god, why I have to fix Youtube broken code?
var listenerName;
var removeCallback;
var listName;
var indexName;
function findNames()
{
  listenerName = /this\.(\w+)\.subscribe/.exec(player.player.addEventListener.toString())[1];
  for (let [k, v] of Object.entries(player.player[listenerName].__proto__))
  {
    if (v.toString().indexOf("delete this") != -1)
    {
      removeCallback = k;
      break;
    }
  }
  for (let [k, v] of Object.entries(player.player[listenerName]))
  {
    if (Array.isArray(v) && v[0] === undefined && typeof(v[1]) === "string")
    {
      listName = k;
    }
    else if (typeof(v) === "object" && v.onStateChange !== undefined)
    {
      indexName = k;
    }
  }
}

function unsubYoutube(ev, fn)
{
  if (!listenerName) findNames();
  
  player.player.removeEventListener(ev, fn);
  let g = player.player[listenerName];
  let list = g[listName];
  for (let idx of g[indexName][ev])
  {
    if (list[idx+1] == fn)
    {
      g[removeCallback](idx);
    }
  }
}