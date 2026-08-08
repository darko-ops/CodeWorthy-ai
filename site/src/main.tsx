import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { GitHubAuthProvider } from "./github-auth";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <GitHubAuthProvider>
        <App />
      </GitHubAuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
