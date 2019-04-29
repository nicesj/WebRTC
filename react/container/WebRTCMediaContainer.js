"use strict";

// ICE: Interactive Connectivity Establishment
// STUN: Session Traversal Utilities for NAT
// TURN: Traversal Using Relays around NAT
// NAT: Network Address Translation
// SDP: Session Description Protocol
// From https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Protocols
// https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection
//
// The latest draft: https://w3c.github.io/webrtc-pc/

import "webrtc-adapter";
import React from "react";
import PropTypes from "prop-types";
import { Socket } from "socket.io-client";

import WebRTCMedia from "../component/WebRTCMedia";
import Error from "../component/Error";

class WebRTCMediaContainer extends React.Component {
  constructor(props) {
    super(props);

    this.state = { hasError: false, error: null, errorInfo: null };

    this.mediaRef = React.createRef();

    this.iceCandidates = [];

    // NOTE:
    // Event callbacks for the SocketIO
    // Each event callback should be bound to the "this" object for referring it from the callback.
    this.socketOnAnswer = this.onAnswer.bind(this);
    this.socketOnIceCandidateChanged = this.onIceCandidateChanged.bind(this);

    // NOTE:
    // Event callbacks for the PC
    this.datachannel = this.onReceiveDataChannel.bind(this);
    this.icegatheringstatechange = this.onIceGatheringStateChanged.bind(this);
    this.icecandidate = this.onIceCandidate.bind(this);
    this.iceconnectionstatechange = this.onIceConnectionStateChanged.bind(this);
    this.track = this.onRemoteTrackAdded.bind(this);
    this.signalingstatechange = this.onSignalingStateChanged.bind(this);
    this.removetrack = this.onRemoveTrack.bind(this);
    this.peeridentity = this.onPeerIdentity.bind(this);
    this.negotiationneeded = this.onNegotiationNeeded.bind(this);
    this.idpvalidationerror = this.onIdPValidationError.bind(this);
    this.idpassertionerror = this.onIdPAssertionError.bind(this);
    this.identityresult = this.onIdentityResult.bind(this);
    this.connectionstatechange = this.onConnectionStateChange.bind(this);

    this.offer = props.offer;
    this.nextState = !!this.offer ? "recvOffer" : "sendOffer";
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error: error };
  }

  componentDidCatch(error, info) {
    console.error(error, info);
    this.setState({ hasError: true, error: error, errorInfo: info });
  }

  componentDidMount() {
    // NOTE:
    // * Because the "event" object, which is given as an argument of the callback,
    //   does not contain the PC object which we need when to find the peer object,
    //   even adds an event callback for the PC(PeerConnection) object,
    //   the "peer" object has to be bound to the callback.
    //   Especially, the Safari does not guarantee that the currentTarget or the target property of the event object is same to the peer.PC object.
    //   (event.currentTarget !== peer.PC && event.target !== peer.PC) in Safari.
    //   (event.currentTarget === peer.PC && event.target === peer.PC) in Chrome.
    // * Keeping the event handler object, in order to remove it during destructing the peer object.
    this.props.socket.on("message", this.socketOnIceCandidateChanged);
    this.props.socket.on("message", this.socketOnAnswer);

    // Initialite the PeerConnections
    const configuration = {
      iceServers: [
        {
          urls: [
            `turns:${this.props.hosts.turns}?transport=udp`,
            `turns:${this.props.hosts.turns}?transport=tcp`,
            `turn:${this.props.hosts.turn}?transport=udp`,
            `turn:${this.props.hosts.turn}?transport=tcp`,
            `stun:${this.props.hosts.stun}`
          ],
          username: "nicesj",
          credential: "dudtkdxhdghk"
        }
      ]
    };
    // { sdpSemantics: "" }; // default: {}, Unified Plan: {sdpSemantics: "unified-plan"}, Plan B: {sdpSemantics: "plan-b"}

    try {
      this.PC = new RTCPeerConnection(configuration);
    } catch (error) {
      this.props.error("ComponentDidMount", error);
      this.props.onDisconnected(this.props.containerId);
      return;
    }

    this.PC.addEventListener("datachannel", this.datachannel);
    this.PC.addEventListener(
      "icegatheringstatechange",
      this.icegatheringstatechange
    );
    this.PC.addEventListener("icecandidate", this.icecandidate);
    this.PC.addEventListener(
      "iceconnectionstatechange",
      this.iceconnectionstatechange
    );
    this.PC.addEventListener("track", this.track);
    this.PC.addEventListener("signalingstatechange", this.signalingstatechange);
    this.PC.addEventListener("removetrack", this.removetrack);
    this.PC.addEventListener("peeridentity", this.peeridentity);
    this.PC.addEventListener("negotiationneeded", this.negotiationneeded);
    this.PC.addEventListener("idpvalidationerror", this.idpvalidationerror);
    this.PC.addEventListener("idpassertionerror", this.idpassertionerror);
    this.PC.addEventListener("identityresult", this.identityresult);
    this.PC.addEventListener(
      "connectionstatechange",
      this.connectionstatechange
    );

    this.trackList = [];

    if (this.props.stream) {
      // Map the local media stream to the created Peer Connection
      const tracks = this.props.stream.getTracks();
      tracks.forEach(track =>
        this.trackList.push(this.PC.addTrack(track, this.props.stream))
      );
    }
  }

  componentDidUpdate() {}

  shouldComponentUpdate(nextProps, nextState) {
    this.props.log("Something is changed", this.props.stream, nextProps.stream);

    if (this.props.stream !== nextProps.stream && !!nextProps.stream) {
      // Map the local media stream to the created Peer Connection
      const tracks = nextProps.stream.getTracks();
      tracks.forEach(track =>
        this.trackList.push(this.PC.addTrack(track, nextProps.stream))
      );
    }

    return true;
  }

  componentWillUnmount() {
    try {
      const stream = this.mediaRef.current.srcObject;
      if (!!stream) {
        const tracks = stream.getTracks();

        /* await */ this.mediaRef.current.pause();

        tracks.forEach(track => {
          track.stop();
        });

        this.mediaRef.current.srcObject = null;
      }

      let sender;
      while (!!(sender = this.trackList.pop())) {
        this.PC.removeTrack(sender);
      }
    } catch (error) {
      this.props.error("componentWillUnmount", error);
    }

    this.props.socket.off("message", this.socketOnIceCandidateChanged);
    this.props.socket.off("message", this.socketOnAnswer);

    this.PC.removeEventListener("datachannel", this.datachannel);
    this.PC.removeEventListener(
      "icegatheringstatechange",
      this.icegatheringstatechange
    );
    this.PC.removeEventListener("icecandidate", this.icecandidate);
    this.PC.removeEventListener(
      "iceconnectionstatechange",
      this.iceconnectionstatechange
    );
    this.PC.removeEventListener("track", this.track);
    this.PC.removeEventListener(
      "signalingstatechange",
      this.signalingstatechange
    );
    this.PC.removeEventListener("removetrack", this.removetrack);
    this.PC.removeEventListener("peeridentity", this.peeridentity);
    this.PC.removeEventListener("negotiationneeded", this.negotiationneeded);
    this.PC.removeEventListener("idpvalidationerror", this.idpvalidationerror);
    this.PC.removeEventListener("idpassertionerror", this.idpassertionerror);
    this.PC.removeEventListener("identityresult", this.identityresult);
    this.PC.removeEventListener(
      "connectionstatechange",
      this.connectionstatechange
    );

    this.PC.close();
  }

  // NOTE:
  // This event handler is going to be called
  // when a new track was added to the PeerConnection.
  onRemoteTrackAdded(event) {
    if (!this.mediaRef.current) {
      this.props.error("Media element was not created yet");
      return;
    }

    event.streams.forEach(stream => {
      if (this.mediaRef.current.srcObject === stream) {
        this.props.log("OnRemoteTrackAdded: already added stream", stream);
        return;
      }
      this.props.log("OnRemoteTrackAdded: add a new stream", stream);

      try {
        this.mediaRef.current.srcObject = stream;
      } catch (error) {
        this.mediaRef.current.src = URL.createObjectURL(stream);
        this.props.error(
          error,
          "Try to fallback method",
          this.mediaRef.current.src
        );
      }
    });
  }

  parseCandidate(candidate) {
    if (!candidate) {
      this.props.log("There is no parsable candidate");
      return;
    }

    const [
      foundation,
      component,
      protocol,
      priority,
      address,
      port,
      ,
      type
    ] = candidate.split(" ");

    return {
      foundation: foundation.split(":")[1],
      component: component,
      protocol: protocol,
      priority: priority,
      address: address,
      port: port,
      type: type
    };
  }

  sendIceCandidate(candidate) {
    let list = [...this.iceCandidates, candidate];

    this.iceCandidates = [];

    let tmp;
    while (!!(tmp = list.shift())) {
      this.props.log(
        "sendIceCandidate",
        tmp.sdpMid ? tmp.sdpMid : "!unknown!",
        tmp.type ? tmp.type : "unknown"
      );
      this.props.socket.send(
        JSON.stringify({
          type: "WebRTC",
          op: "ice",
          id: this.props.socket.id,
          ice: tmp
        })
      );
    }
  }

  onIceCandidate(event) {
    if (!event.candidate) {
      this.props.log("Candidate data is not available");
      return;
    }

    const info = this.parseCandidate(event.candidate.candidate);

    this.props.log(`Candidates: ${info.address}:${info.port}`);

    if (this.nextState !== "completed") {
      // Send the events when the PC is ready
      this.iceCandidates.push(event.candidate);
    } else {
      // Until the PC is completed, we have not to send the ice changed event.
      this.sendIceCandidate(event.candidate);
    }
  }

  onReceiveDataChannel(event) {
    this.props.log(event);

    const dataChannel = event.channel;

    dataChannel.addEventListener("open", event => {
      this.props.log("Open data channel", event);
      dataChannel.send("Hello world!!! Am I connected?");
    });

    dataChannel.addEventListener("close", event => {
      this.props.log("Close data channel", event);
    });

    dataChannel.addEventListener("message", event => {
      this.props.log(event, "Receive data", event.data);
    });

    // dataChannel.readyState
    // dataChannel.send("Message");
    //
    // dataChannel.close();
    // dataChannel = null
  }

  createDataChannel(label, channelId) {
    let option;
    let dataChannel;

    if (typeof channelId === "number") {
      option = {
        negotiated: true,
        id: channelId
      };
    }

    try {
      // NOTE: Does it require to check the createDataChannel method before invoking it?
      dataChannel = this.PC.createDataChannel(label, option);
    } catch (error) {
      this.props.error(error);
      return;
    }

    dataChannel.addEventListener("open", event => {
      this.props.log("Open data channel", event);
    });

    dataChannel.addEventListener("close", event => {
      this.props.log("Close data channel", event);
    });

    dataChannel.addEventListener("message", event => {
      this.props.log(event, "Receive data", event.data);
    });
  }

  async onIceCandidateChanged(_message) {
    const message = JSON.parse(_message);

    if (
      message.type !== "WebRTC" ||
      message.op !== "ice" ||
      message.id === this.props.socket.id
    ) {
      return;
    }

    if (this.nextState !== "completed") {
      this.props.log(
        "onIceCandidates",
        "peer is not prepared yet. Dropping the ice candidates",
        message.ice
      );
    } else {
      this.props.log(
        "onIceCandidates",
        "Add ice candidates",
        message.ice.sdpMid,
        message.ice.type ? message.ice.type : "unknown"
      );
      try {
        await this.PC.addIceCandidate(message.ice);
      } catch (error) {
        this.props.error(error);
      }
    }
  }

  onIceConnectionStateChanged(event) {
    this.props.log("onIceConnectionStateChanged", this.PC.iceConnectionState);

    switch (this.PC.iceConnectionState) {
      case "failed":
        // Restart the connection process
        this.nextState = "sendOfferAgain";
        this.props.log("onIceConnectionStateChanged", "Try again");

        let sender;
        while (!!(sender = this.trackList.pop())) {
          this.PC.removeTrack(sender);
        }

        if (this.props.stream) {
          // Map the local media stream to the created Peer Connection
          const tracks = this.props.stream.getTracks();
          tracks.forEach(track =>
            this.trackList.push(this.PC.addTrack(track, this.props.stream))
          );
        }
        break;
      case "closed":
      case "disconnected":
        this.props.onDisconnected(this.props.containerId);
        break;
      case "connected":
        break;
      case "new":
        break;
      case "checking":
        break;
      case "completed":
        break;
      default:
        this.props.log(
          "onIceConnectionStateChanged.unknown",
          this.PC.iceConnectionState,
          event
        );
        break;
    }
  }

  onIceGatheringStateChanged(event) {
    this.props.log("onIceGatheringStateChanged", this.PC.iceGatheringState);
    switch (this.PC.iceGatheringState) {
      case "new":
        break;
      case "gathering":
        break;
      case "complete":
        break;
      default:
        this.props.log(
          "onIceGatheringStateChanged.unknown",
          this.PC.iceGatheringState,
          event
        );
        break;
    }
  }

  // NOTE
  // State transition [Caller]
  //   new RTCPeerConnection()       : stable
  //   setLocalDescription(offer)    : have-local-offer
  //   setRemoteDescription(pranswer): have-remote-pranswer
  //   setRemoteDescription(answer)  : stable
  //
  // State transition [Callee]
  //   new RTCPeerConnection()       : stable
  //   setRemoteDescription(offer)   : have-remote-offer
  //   setLocalDescription(pranswer) : have-local-pranswer
  //   setLocalDescription(answer)   : stable
  //
  async onSignalingStateChanged(event) {
    switch (this.PC.signalingState) {
      case "stable":
        if (this.nextState === "sendingAnswer") {
          this.nextState = "completed";
          this.props.socket.send(
            JSON.stringify({
              type: "WebRTC",
              op: "answer",
              id: this.props.socket.id,
              answer: this.PC.localDescription
            })
          );
        }
        break;
      case "have-local-offer":
        if (this.nextState === "sendingOffer") {
          this.props.socket.send(
            JSON.stringify({
              type: "WebRTC",
              op: "offer",
              id: this.props.socket.id,
              offer: this.offer
            })
          );

          this.nextState = "waitAnswer";
        }
        break;
      case "have-remote-offer":
        if (this.nextState === "sendAnswer") {
          try {
            const answer = await this.PC.createAnswer({
              offerToReceiveAudio: 1,
              offerToReceiveVideo: 1
            });

            this.nextState = "sendingAnswer";

            // Apply the description to the local and the remote Peer Connections.
            // Following code is going to fire the "OnRemoteTrackAdded" and then "signalingstatechanged: stable"
            await this.PC.setLocalDescription(answer);
          } catch (error) {
            this.props.error(error);
            this.props.onDisconnected(this.props.containerId);
          }
        }
        break;
      case "have-local-pranswer": // createAnswer & setLocalDescription
        this.props.log(this.PC.signalingState, this.nextState);
        break;
      case "have-remote-pranswer": // answer applied & setLocalDescription
        this.props.log(this.PC.signalingState, this.nextState);
        break;
      default:
        this.props.error(this.PC.signalingState, this.nextState);
        break;
    }
  }

  onRemoveTrack(event) {
    this.props.log(this.PC, event);
  }

  onPeerIdentity(event) {
    this.props.log(this.PC, event);
  }

  // NOTE:
  // this event handler is going to be invoked after adding tracks to the peer connection.
  // https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/onnegotiationneeded
  async onNegotiationNeeded(event) {
    this.props.log(
      this.PC.iceConnectionState,
      this.PC.iceGatheringState,
      this.PC.signalingState,
      this.nextState
    );

    switch (this.nextState) {
      case "recvOffer":
        try {
          this.nextState = "sendAnswer";
          // Following code is going to fire the "signalingstatechanged:have-remote-offer" event.
          await this.PC.setRemoteDescription(this.offer);
        } catch (error) {
          // Error : Failed to set remote offer sdp: Session error code: ERROR_CONTENT. Session error description: Failed to set remote video description send parameters.
          // Answer: [1] https://bugs.chromium.org/p/webrtc/issues/detail?id=4957
          //         [2] https://stackoverflow.com/questions/46460287/failed-to-set-remote-offer-sdp-session-error-code-error-content
          this.props.error("recvOffer", error, this.offer);
          this.props.onDisconnected(this.props.containerId);
        }
        break;
      case "sendAnswer":
        // note: "signalingstatechanged: have-remote-offer" would handle this.
        break;
      case "sendingAnswer":
        break;
      case "sendOfferAgain":
      case "sendOffer":
        const options = {
          offerToReceiveAudio: 1,
          offerToReceiveVideo: 1,
          iceRestart: this.nextState === "sendOfferAgain"
        };

        this.nextState = "sendingOffer";
        try {
          this.offer = await this.PC.createOffer(options);

          // NOTE:
          // Apply the description to the local and remote Peer Connections.
          // Following code is going to fire the "signalingstatechanged" event first.
          // "signalingstatechanged: have-local-offer"
          // After setting the local description, the onIceChange event will be fired.
          // however, we do not send it to the remote until the remote send the answer to us.
          await this.PC.setLocalDescription(this.offer);
          // After signalingstatechanged event callback (have-local-offer) called, comes back to here.
        } catch (error) {
          this.props.error("sendOffer", error);
          this.props.onDisconnected(this.props.containerId);
        }
        break;
      case "sendingOffer":
        break;
      case "waitAnswer":
        break;
      case "completed":
        break;
      default:
        break;
    }
  }

  onIdPValidationError(event) {
    this.props.log(this.PC, event);
  }

  onIdPAssertionError(event) {
    this.props.log(this.PC, event);
  }

  onIdentityResult(event) {
    this.props.log(this.PC, event);
  }

  onConnectionStateChange(event) {
    this.props.log(this.PC, event);
  }

  async onAnswer(_message) {
    const message = JSON.parse(_message);

    if (
      message.type !== "WebRTC" ||
      message.op !== "answer" ||
      message.id === this.props.socket.id
    ) {
      return;
    }

    this.answer = message.answer;

    if (this.nextState === "waitAnswer") {
      try {
        this.nextState = "completed";
        // NOTE: !important, unlike the sending offer phase,
        // onsignalingstatechanged:have-remote-offer event will not be fired.
        await this.PC.setRemoteDescription(this.answer);

        // After the PC is prepared, sending all ice candidates if exists.
        this.sendIceCandidate(null);
      } catch (error) {
        // Error : Failed to set remote offer sdp: Session error code: ERROR_CONTENT. Session error description: Failed to set remote video description send parameters.
        // Answer: [1] https://bugs.chromium.org/p/webrtc/issues/detail?id=4957
        //         [2] https://stackoverflow.com/questions/46460287/failed-to-set-remote-offer-sdp-session-error-code-error-content
        this.props.error("waitAnswer", error);
        this.props.onDisconnected(this.props.containerId);
      }
    }
  }

  render() {
    if (this.state.hasError === true) {
      return <Error error={this.state.error} info={this.state.errorInfo} />;
    }

    return (
      <WebRTCMedia
        refs={{
          media: this.mediaRef
        }}
        muted={this.props.muted}
        autoPlay={this.props.autoPlay}
        width={this.props.width}
        height={this.props.height}
        poster={this.props.poster}
      />
    );
  }
}

WebRTCMediaContainer.propTypes = {
  socket: PropTypes.instanceOf(Socket).isRequired,
  log: PropTypes.func.isRequired,
  error: PropTypes.func.isRequired,
  onDisconnected: PropTypes.func.isRequired,
  hosts: PropTypes.object.isRequired,
  muted: PropTypes.bool,
  autoPlay: PropTypes.bool,
  poster: PropTypes.string,
  width: PropTypes.number,
  height: PropTypes.number,
  offer: PropTypes.object,

  // The IE11 suffers from "stream" property.
  // It cannot load a page properly even though
  // the WebRTCMediaContainer Component implemented the methods for catching errors of the React.Component.
  stream: PropTypes.instanceOf(MediaStream)
};

export default WebRTCMediaContainer;
