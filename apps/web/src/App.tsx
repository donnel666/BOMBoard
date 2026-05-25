import "./App.css";

function App() {
  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">Initialized Workspace</p>
        <h1>BOMBoard</h1>
        <p className="summary">
          React, Vite, TypeScript, and Electron are wired up. Feature
          implementation has not started yet.
        </p>
      </section>

      <section className="grid">
        <article className="card">
          <h2>Web App</h2>
          <p>
            The browser shell lives in <code>apps/web</code>.
          </p>
        </article>

        <article className="card">
          <h2>Desktop Shell</h2>
          <p>
            Electron wraps the same frontend from <code>apps/desktop</code>.
          </p>
        </article>

        <article className="card">
          <h2>Shared Packages</h2>
          <p>
            Core, parser, viewer, and UI packages are scaffolded under{" "}
            <code>packages/*</code>.
          </p>
        </article>
      </section>
    </main>
  );
}

export default App;
