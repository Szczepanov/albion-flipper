

export default function Crafting() {
  return (
    <div className="flex-col gap-4">
      <div className="mb-4">
        <h1>Crafting & Refining Calculator</h1>
        <p>Determine profitability of refining raw resources or crafting equipment based on live market data.</p>
      </div>

      <div className="glass-panel flex-col items-center gap-4" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
        <h2 style={{ color: 'var(--accent-primary)' }}>Setting up the Workbenches...</h2>
        <p>This module is currently under active development. Advanced crafting math requiring recipe trees and royal return rates will be deployed in the next minor patch.</p>
      </div>
    </div>
  );
}
