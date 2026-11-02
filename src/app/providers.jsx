import { Component } from "react";

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

export default function AppProviders({ children }) {
  return <Boundary>{children}</Boundary>;
}
