export function Home() {
  return (
    <main className="home">
      <h1>SoLP</h1>
      <p className="muted">A companion table for the LoR PMTTRPG.</p>
      <nav className="home-links">
        <a className="big-button" href="/gm">Game Master</a>
        <a className="big-button" href="/board">Game Board (iPad)</a>
        <a className="big-button" href="/play">Join as Player</a>
      </nav>
    </main>
  );
}
