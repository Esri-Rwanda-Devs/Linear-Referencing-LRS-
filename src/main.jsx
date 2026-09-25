import { Component } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

class Boundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) return <pre className="crash">{this.state.error.stack}</pre>;
    return this.props.children;
  }
}

createRoot(document.getElementById("root")).render(
  <Boundary>
    <App />
  </Boundary>
);
