import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";

const root = ReactDOM.createRoot(document.getElementById("root"));

// /#ganamos es una página aparte, con acceso limitado (ver GanamosImportLimitado.jsx) —
// ni siquiera carga el bundle de App.jsx, para que quede separada de verdad.
if (window.location.hash.startsWith("#ganamos")) {
  import("./GanamosImportLimitado.jsx").then(({ default: GanamosImportLimitado }) => {
    root.render(
      <React.StrictMode>
        <GanamosImportLimitado />
      </React.StrictMode>
    );
  });
} else {
  import("./App.jsx").then(({ default: App }) => {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  });
}
