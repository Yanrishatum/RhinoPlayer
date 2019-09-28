<?php
require_once "vendor/sleekdb/SleekDB.php";

define("TYPE_PUBLIC", 0);
define("TYPE_PRIVATE", 1);

$dbDir = __DIR__ . "/db";
$sessions = \SleekDB\SleekDB::store('sessions', $dbDir);

// Clean old records
$treshold = time() - 60*60*24;
$sessions->where("timestamp", '<', $treshold)->delete();

function findById($id)
{
  global $sessions;
  $res = $sessions->where('id', '=', $id)->fetch();
  if (count($res) == 0) return null;
  return $res[0];
}
function findByName($name)
{
  global $sessions;
  $res = $sessions->where('name', '=', $name)->fetch();
  if (count($res) == 0) return null;
  return $res[0];
}

if (!isset($_REQUEST["method"]))
{
  die(json_encode([ 'error' => "No method was provided"]));
}

switch ($_REQUEST["method"])
{
  case "list":
    $records = $sessions->where('type', '!=', TYPE_PRIVATE)->fetch(); // orWhere(peers.$id = $name)
    $result = [];
    foreach($records as $record)
    {
      $result[] = [
        "name" => $record["name"],
        "id" => $record["id"],
        "users" => count($record["peers"]),
        "password_protected" => $record["password"] != "",
        "url" => $record["url"],
        "meta" => $record["meta"]
      ];
    }
    echo json_encode($result);
    break;
  case "create":
    $roomName = $_REQUEST["name"];
    if (empty(findByName($roomName)))
    {
      $rec = [
        "timestamp" => time(),
        "name" => $roomName,
        "type" => (isset($_REQUEST["type"]) && $_REQUEST["type"] == "private") ? TYPE_PRIVATE : TYPE_PUBLIC,
        "id" => uniqid(),
        "url" => isset($_REQUEST["url"]) ? $_REQUEST["url"] : "",
        "meta" => isset($_REQUEST["meta"]) ? $_REQUEST["meta"] : "",
        "password" => isset($_REQUEST["password"]) ? $_REQUEST["password"] : "",
        "peers" => [
          $_REQUEST["id"] => $_REQUEST["peer"]
        ]
      ];
      $sessions->insert($rec);
      echo json_encode(["id" => $rec["id"]]);
    }
    else
    {
      die(json_encode([ 'error' => "Already have a room under the name $roomName"]));
    }
    break;
  case "join":
    
    $record = null;
    if (isset($_REQUEST["name"])) $record = findByName($_REQUEST["name"]);
    else if (isset($_REQUEST["id"])) $record = findById($_REQUEST["id"]);
    if (!empty($record))
    {
      if ($record["password"] != "" && $record["password"] != $_REQUEST["password"]) 
      {
        die(json_encode(["error" => "Invalid password"]));
        return;
      }
      echo json_encode([ "peers" => $record["peers"], "url" => $record["url"] ]);
    }
    else
    {
      die(json_encode(["error" => "Room not found"]));
    }
    break;
  case "update":
    $record = findById($_REQUEST["id"]);
    if (!isset($record))
    {
      die(json_encode(["error", "Room not found"]));
    }
    $updInfo = array();
    
    if (isset($_REQUEST["mesh"]))
    {
      $meshInfo = array();
      foreach($_REQUEST["mesh"] as $user)
      {
        $expl = explode(":::", $user);
        $meshInfo[$expl[0]] = $expl[1];
      }
      $updInfo["peers"] = $meshInfo;
    }
    
    if (isset($_REQUEST["url"])) $updInfo["url"] = $_REQUEST["url"];
    if (isset($_REQUEST["meta"])) $updInfo["meta"] = $_REQUEST["meta"];
    
    if (count($updInfo) != 0) $updInfo["timestamp"] = time();
    
    $sessions->where("id", "=", $_REQUEST["id"])->update($updInfo);
    echo json_encode(["success" => true]);
    break;
  case "report":
    $sessions->where('id', '=', $_REQUEST["id"])->delete();
    echo json_encode(["success"=>true]);
    break;
  default:
    print_r($_REQUEST);
    die(json_encode(["error" => "Invalid method"]));
}

?>