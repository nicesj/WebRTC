"use strict";

import React from "react";
import "./Error.scss";

class Error extends React.Component {
  constructor(props) {
    super(props);

    this.state = { hasError: false };

    this.error = this.props.error;
    this.info = this.props.info;
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI.
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error(error, info);
    this.error = error;
    this.info = info;
    this.setState({ hasError: true });
  }

  render() {
    let infoString;
    let errorString;

    if (this.error) {
      if (typeof this.error.toString === "function") {
        errorString = this.error.toString();
      } else {
        try {
          errorString = JSON.stringify(this.error);
        } catch (error) {
          errorString = 'Unable to display the "error" object';
        }
      }

      errorString = <div className="Error">{errorString}</div>;
    }

    if (this.info) {
      if (typeof this.info.toString === "function") {
        infoString = this.info.toString();
      } else {
        try {
          infoString = JSON.stringify(this.info);
        } catch (error) {
          infoString = 'Unable to display the "info" object';
        }
      }

      infoString = <div className="Info">{infoString}</div>;
    }

    return (
      <div className="Error">
        {this.state.hasError ? (
          <b>Occurred by the Error Component itself</b>
        ) : null}
        {errorString}
        {infoString}
      </div>
    );
  }
}

export default Error;
