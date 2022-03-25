import { useEffect, useRef, useState } from 'react';
import './App.scss';

class FileSender {
  constructor(file, con, file_done_callback = null, progress_callback = null)
  {
    this.file = file
    this.reader = file.stream().getReader();
    this.channel = con.createDataChannel(`file_transfer_${file.name}`)
    this.max_buffer = 8 * 1024 * 1024;
    this.current_pos = 0;
    this.initiated = false;
    this.chunk_size = 16 * 1024;
    this.file_done_callback = file_done_callback;
    this.progress_callback = progress_callback;
    this.start_time = 0;

    this.channel.bufferedAmountLowThreshold = this.max_buffer / 2;
    this.channel.onbufferedamountlow = event => {
      this.fillBuffer();
    };
    this.channel.onclose = event => {
      if (this.file_done_callback !== null)
      {
        this.file_done_callback(this.current_pos / this.file.size);
      }
    }
  }

  _sendData(done, value) {
    if (done)
    {
      if (this.channel.readyState !== "open")
        return 1;
      console.log("Sent all data");
      this.channel.send(JSON.stringify({"done": done,
                                        "size": this.current_pos}));
      return 1;
    }
    for (let i = 0; i < value.length; i += this.chunk_size)
    {
      this.channel.send(value.slice(i, Math.min(value.length, i+this.chunk_size)));
    }
    this.current_pos += value.length;
    if (this.progress_callback !== null)
    {
      const current_time = new Date();
      const eta = ((current_time - this.start_time)) * (this.file.size / this.current_pos - 1);
      this.progress_callback(this.current_pos * 100 / this.file.size, new Date(eta));
    }

    if (this.channel.bufferedAmount > this.max_buffer)
    {
      console.log("Buffer is filled.")
      return 0;
    }

    return this.reader.read().then(({done, value}) => {this._sendData(done, value)});
  }

  fillBuffer() {
    if (this.channel.bufferedAmount > this.max_buffer)
    {
      console.log("Buffer is full already")
      return 0;
    }
    return this.reader.read().then(({done, value}) => {this._sendData(done, value)});
  }

  end() {
    this.channel.bufferedAmountLowThreshold = 0;
    this.channel.onbufferedamountlow = () => {
      if (this.channel.readyState !== "closed")
      {
        this.channel.close();
      }
    }
  }

  send() {
    this.initiated = false;
    if (!this.channel.onopen)
    {
      console.log("Setting up on open event");
      this.channel.onopen = event => {
        if (!this.initiated)
        {
          console.log("Channel opened!")
          this.start_time = new Date();
          this.channel.send(JSON.stringify({"filename": this.file.name,
                                            "type": this.file.type,
                                            "size": this.file.size}));
        }
        else
        {
          console.log("Channel opened put transfer already in progress!")
        }
        this.initiated = true;
        this.fillBuffer();
      }
    }
  }
}

class FileReceiver {
  constructor(channel,
              file_done_callback = null,
              progress_callback = null,
              file_info_callback = null,
              file_error_callback = null)
  {
    this.channel = channel;
    this.file_done_callback = file_done_callback;
    this.progress_callback = progress_callback;
    this.file_info_callback = file_info_callback;
    this.file_error_callback = file_error_callback;
    this.start_time = new Date();
    
    this.channel.onmessage = e => {this.handleMessage(e)};
    this.channel.onopen = e => {this.handleOpen(e)};
    this.channel.onclose = e => {this.handleClose(e)};
  }

  handleMessage(event)
  {
    const data = event.data;
    if (this.size !== 0 && this.size !== this.current_data_size)
    {
      this.addData(data);
      if (this.progress_callback !== null &&
          this.current_data_size - this.last_progress_update >= this.size / 100)
      {
        const current_time = new Date();
        this.last_progress_update = this.current_data_size;
        const prog = this.current_data_size * 100 / this.size;
        const eta = ((current_time - this.start_time)) * (this.size / this.current_data_size - 1);
        this.progress_callback(prog, new Date(eta));
      }
      return;
    }
    try {
      const json = JSON.parse(data);
      if (json.done)
      {
        if (this.file_done_callback !== null)
        {
          this.file_done_callback(this.getFile);
        }
        if(this.progress_callback !== null)
        {
          this.progress_callback(100, new Date(0));
        }
        console.log("File done downloading");
        if (this.channel.readyState !== "closed")
        {
          this.channel.close();
        }
        if (this.connection.readyState !== "closed")
        {
          this.connection.close();
        }
      }
      if (json.filename) {
        this.setup(json.filename,
                   json.size,
                   json.type);
        console.log(`Receiving file: ${json}`);
      }
    }
    catch (e) {
      console.log("Error reading the json data", e);
    }
  }

  handleOpen(event)
  {
    console.log(`(${event.currentTarget.label}) channel open`);
  }

  handleClose(event)
  {
    console.log(`(${event.currentTarget.label}) channel close`);
    if (this.current_data_size < this.size)
      this.file_error_callback(this.current_data_size / this.size);
  }

  setup(filename, filesize, filetype)
  {
    this.name = filename;
    this.size = filesize;
    this.type = filetype;
    this.data = [];
    this.current_data_size = 0;
    this.last_progress_update = 0;
    this.file_info_callback({name: this.name,
                             size: this.size,
                             type: this.type});
    this.start_time = new Date();
  }

  addData(data)
  {
    this.data.push(data);
    if (data instanceof ArrayBuffer)
      this.current_data_size += data.byteLength;
    else
      this.current_data_size += data.size;
  }
  
  get getFile()
  {
    if (this.current_data_size === this.size)
    {
      return new File(this.data, this.name, {type: this.type});
    }
    return null;
  }
}

class Signaling {
  constructor(address,
              ice_callback = null,
              remote_desc_callback = null)
  {
    this.websocket = new WebSocket(address);
    this.websocket.onmessage = e => {this.handleMessage(e)};
    this.websocket.onclose = e => {this.handleClose(e)};
    this.websocket.onopen = e => {this.handleOpen(e)};
    this.create_callback = null;
    this.ice_update_callback = ice_callback;
    this.remote_desc_callback = remote_desc_callback;
  }
  createRoom(callback = null)
  {
    this.websocket.send(JSON.stringify({create_room: true}));
    this.create_callback = callback;
  }
  
  updateOffer(_id, offer)
  {
    this.websocket.send(JSON.stringify({update_offer: 
      {
        id: _id,
        type: offer.type,
        sdp: offer.sdp
      }}));
  }

  handleMessage(event)
  {
    try {
      const json = JSON.parse(event.data);
      console.log(json);
      switch (json.request)
      {
        case "create_room":
          if (this.create_callback !== null)
          {
            this.create_callback(json.id);
          }
          break;
        case "ice_candidate":
          if (this.ice_update_callback !== null)
          {
            this.ice_update_callback(json.id, json.ice_candidate);
          }
          break;
        case "get_offer":
          if (this.remote_desc_callback !== null)
          {
            this.remote_desc_callback(json.id, json.type, json.sdp);
          }
          break;
        case "recv_answer":
          if (this.remote_desc_callback !== null)
          {
            this.remote_desc_callback(json.id, json.type, json.sdp);
          }
          break;
        default:
          break;
      }
    } catch {

    }
  }

  handleClose(event) {
    console.log(event);
  }

  handleOpen(event) {
    console.log(event);
  }

  sender() {
    this.mode = "sender";
  }

  receiver() {
    this.mode = "receiver";
  }

  updateIce(json, _id)
  {
    this.websocket.send(JSON.stringify({ice_update: {
      ice_candidate: json,
      id: _id,
      peer: this.mode}}));
  }

  createAnswer(_id, answer)
  {
    this.websocket.send(JSON.stringify({create_answer: {
      type: answer.type,
      sdp: answer.sdp,
      id: _id
    }}))
  }

  getOffer(_id)
  {
    this.websocket.send(JSON.stringify({get_offer: {
      id: _id
    }}));
  }
}

class Peer {
  constructor(sender = false,
              blob_callback = null,
              progress_callback = null,
              room_id_callback = null,
              file_info_callback = null,
              file_error_callback = null)
  {
    /*this.configuration = {
      iceServers: [
        {
          urls: 'stun:stun.l.google.com:19302'
        }
      ]
    }*/
    this.configuration = {
      iceServers: [
        {
          urls: 'stun:stun.l.google.com:19302'
        },
        {
          urls: 'turn:toastyfiles.com:3478?transport=udp',
          username: 'ligma',
          credential: 'balls'
        }
      ]
    }
    console.log("Generating peer")
    this.room_id_callback = room_id_callback;
    this.progress_callback = progress_callback;
    this.blob_callback = blob_callback;
    this.file_info_callback = file_info_callback;
    this.file_error_callback = file_error_callback;
    this.sender = sender; //false = receiver, true = sender
    this.room_id = null;
    this.fileReceiver = null;
    this.fileSender = null;
    this.setup1();
    const websocket_link = (window.location.hostname === "localhost") ? 
    `ws://${window.location.hostname}:8765` :
    `wss://${window.location.hostname}/ws`;
    this.signaling = new Signaling(websocket_link,
    (_id, candidate) => {
      this.connection.addIceCandidate(new RTCIceCandidate(candidate));
    },
    (_id, type, sdp) => {
      console.log("Updating remote connection");
      this.connection.setRemoteDescription({type: type, sdp: sdp}).then(() => {
        if (!this.sender)
        {
          this.connection.createAnswer().then(answer => {
            this.connection.setLocalDescription(answer);
            this.signaling.createAnswer(_id, answer);
          })
        }
      });
    });
    this.setup2();
  }

  reset()
  {
    this.room_id = null;
    this.fileReceiver = null;
    this.fileSender = null;
    this.setup1();
    this.setup2();
  }

  setup1()
  {
    this.connection = new RTCPeerConnection(this.configuration);
    this.connection.onicecandidate = event => {
      if (event.candidate && event.candidate.candidate !== "") {
        console.log("Sending over remote candidates");
        const cand = event.candidate.toJSON();
        console.log(cand);
        this.signaling.updateIce(cand, this.room_id);
      }
    };
  }

  setup2()
  {
    if (this.sender)
    {
      this.signaling.mode = "sender";
      this.connection.onnegotiationneeded = event => {
        this.signaling.createRoom(_id => {
          this.connection.createOffer().then(offer => {
            this.room_id = _id;
            this.signaling.updateOffer(_id, offer);
            if (this.room_id_callback !== null)
            {
              this.room_id_callback(this.room_id);
            }
            this.connection.setLocalDescription(offer);
          });
        });
      };
    }
    else
    {
      this.signaling.mode = "receiver";
      this.connection.ondatachannel = event => {
        this.fileReceiver = new FileReceiver(event.channel,
                                             this.blob_callback,
                                             this.progress_callback,
                                             this.file_info_callback,
                                             this.file_error_callback);
      };
    }
  }

  recv_update_id(_id)
  {
    this.room_id = _id;
    if (this.signaling.websocket.readyState !== "open")
      this.signaling.handleOpen = () => {this.signaling.getOffer(_id)};
    else
      this.signaling.getOffer(_id);
  }

  sendFile(file) {
    const promise = new Promise((resolve, reject) => {
      this.fileSender = new FileSender(file,
                                       this.connection,
                                       p => {
                                         if (this.connection.readyState !== "closed")
                                         {
                                           this.connection.close();
                                         }
                                         if (p === 1)
                                           resolve(file);
                                         else
                                           reject(p);
                                       },
                                       this.progress_callback);
    });
    console.log("Creating file sender")
    console.log("Sending file")
    this.fileSender.send();
    return promise;
  }

  end() {
    this.connection.close();
  }
}

function App() {
  const [peer, setPeer] = useState(null);
  
  const fileRef = useRef();

  const [blob, setBlob] = useState(null);

  const [progress, setProgress] = useState(0);
  const [fileEta, setFileEta] = useState(null);
  const [roomId, setRoomId] = useState("");
  const [mode, setMode] = useState("sender");
  const [file, setFile] = useState(null);
  const [copied, setCopied] = useState(false);
  const [etaString, setEtaString] = useState("");
  const [errorString, setErrorString] = useState("");

  useEffect(() => {
    if (!peer || roomId === "")
      return
    if (!peer.sender)
    {
      peer.recv_update_id(roomId);
    }
  }, [roomId, peer]);

  useEffect(() => {
    if (mode === "")
      return
    setPeer(new Peer(mode === "sender",
                     setBlob,
                     (prog, eta) => {
                       setProgress(prog);
                       setFileEta(eta)
                     },
                     setRoomId,
                     f => {
                       setFile(f);
                     },
                     p => {
                       setErrorString("Error: Sender ended transaction");
                     }))
  }, [mode]);

  useEffect(() => {
    const window_pathname = window.location.pathname.split("/");
    window.onunload = event => {
      setPeer(p => {p.end();return p});
    }
    if (window_pathname[1] !== '')
    {
      setRoomId(window_pathname[1]);
      setMode("receiver");
    }
  }, [])

  useEffect(() => {
    if (fileEta === null)
      return;
    setEtaString((fileEta.getHours() > 1 ? (fileEta.getHours()-1) + "h" : "") +
               (fileEta.getMinutes() > 0 ? fileEta.getMinutes() + "m" : "") +
               (fileEta.getSeconds() > 0 ? fileEta.getSeconds() + "s" : ""));
  }, [fileEta])

  return (
    <>
      <h1>Toasty Files🍞</h1>
      {mode === "" ?
        <div className="mainContainer">
          <button onClick={() => {
            setMode("sender");
          }}>Sender</button>
          <button onClick={() => {
            setMode("receiver");
          }}>Receiver</button>
        </div>: null}
      {mode === "sender" ? 
        <div className="mainContainer" onDrop={e => {
          e.preventDefault();
          setFile(e.dataTransfer.files[0]);
        }} onDragOver={e => {
          e.preventDefault();
        }}>
            <label htmlFor="fileInput" className="uploadButton">
              {file === null ? "📄 Select a file" : `📄 ${file.name}`}
            </label>
          <input id="fileInput" type="file" disabled={roomId !== ""} ref={fileRef} onInput={e => {
            setErrorString("");
            if (e.target.files[0])
            {
              setFile(e.target.files[0]);
            }
            else
            {
              setFile(null);
            }
          }}/>
          
        {roomId !== "" ?
          <div className="roomIdTextArea" onClick={() => {
              try {
                navigator.clipboard.writeText(`${window.location.hostname === "localhost" ?
                                                 "http" : "https"}://${window.location.host}/${roomId}`);
                setCopied(true);
              }
              catch {
                console.log("Could not copy the clipboard")
              }
          }}>
            {roomId}
          </div>
          :
          file !== null ? 
            <button className="generateButton" onClick={() => {
              fileRef.current.disabled = true;
              peer.sendFile(file).then(() => {
                fileRef.current.disabled = false;
                fileRef.current.value = '';
                setRoomId("");
                setFile(null);
                setProgress(0);
                setCopied(false);
                setFileEta(new Date(0));
                peer.reset();
              }).catch(p => {
                fileRef.current.disabled = false;
                fileRef.current.files = []
                setRoomId("");
                setFile(null);
                setProgress(0);
                setCopied(false);
                setFileEta(new Date(0));
                peer.reset();
                setErrorString(`Error: Receiver ended transaction`);
              });
            }}>Generate</button> : null}
        {copied ? 
        <div className="infoBox">Copied to clipboard!</div>: null}
        {progress !== 0 ? <progress className="fileTransferProgress"
                                    value={progress}
                                    max="100">
                          </progress> : null}
        {etaString !== "" ? <div className="eta">ETA: {etaString}</div> : null}
        {errorString !== "" ? <div className="error">{errorString}</div> : null}
        </div>: null}
        {mode === "receiver" ?
          <div className="mainContainer">
            <div className="fileName">📄 {file !== null ? file.name : null}</div>
            <div className="roomIdTextArea">
              {roomId}
            </div>
            {progress !== 0 ? <progress className="fileTransferProgress"
                                        value={progress}
                                        max="100">
                              </progress> : null}
            {blob ? <a className="downloadButton"
                       download={blob.name}
                       href={window.URL.createObjectURL(blob)}>
                      💾 Download
                    </a> : null}
            {etaString !== "" ? <div className="eta">ETA: {etaString}</div> : null}
            {errorString !== "" ? <div className="error">{errorString}</div> : null}
          </div> : null}
    </>
  );
}

export default App;
