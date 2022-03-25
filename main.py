import websockets
import asyncio
import json
import uuid

rooms = {}


async def echo(websocket, path):
    while(websocket.open):
        message = await websocket.recv()
        _json = json.loads(message)
        if _json.get("create_room"):
            _id = str(uuid.uuid4())[:8]
            await websocket.send(json.dumps({"request": "create_room",
                                             "id": _id}))
        elif _json.get("update_offer"):
            request = _json["update_offer"]
            rooms.update({request["id"]: {"type": request.get("type"),
                                          "sdp": request.get("sdp"),
                                          "sender_socket": websocket}})
            await websocket.send(json.dumps({"request": "update_offer",
                                             "id": _id}))
        elif _json.get("create_answer"):
            request = _json["create_answer"]
            room = rooms.get(request["id"])
            if room:
                await room["sender_socket"].send(json.dumps(
                    {"request": "recv_answer",
                     "id": request["id"],
                     "type": request["type"],
                     "sdp": request["sdp"]}))
        elif _json.get("get_offer"):
            request = _json["get_offer"]
            room = rooms.get(request["id"])
            if room:
                room["receiver_socket"] = websocket
                await websocket.send(json.dumps(
                    {"request": "get_offer",
                     "id": request["id"],
                     "type": room["type"],
                     "sdp": room["sdp"]}))
                if room.get("sender_ice"):
                    for candidate in room["sender_ice"]:
                        print(candidate)
                        await websocket.send(json.dumps(
                            {"request": "ice_candidate",
                             "id": request["id"],
                             "ice_candidate": candidate}))
        elif _json.get("ice_update"):
            request = _json["ice_update"]
            room = rooms.get(request["id"])
            if room:
                if request["peer"] == "sender":
                    if room.get("sender_ice"):
                        room["sender_ice"].append(request["ice_candidate"])
                    else:
                        room["sender_ice"] = [request["ice_candidate"]]
                    if room.get("receiver_socket"):
                        await room["receiver_socket"].send(json.dumps(
                            {"request": "ice_candidate",
                             "id": request["id"],
                             "ice_candidate": request["ice_candidate"]}))
                elif request["peer"] == "receiver":
                    if room.get("receiver_ice"):
                        room["receiver_ice"].append(request["ice_candidate"])
                    else:
                        room["receiver_ice"] = [request["ice_candidate"]]
                    if room.get("sender_socket"):
                        await room["sender_socket"].send(json.dumps(
                            {"request": "ice_candidate",
                             "id": request["id"],
                             "ice_candidate": request["ice_candidate"]}))


async def main():
    async with websockets.serve(echo, "", 8765):
        await asyncio.Future()

asyncio.run(main())
