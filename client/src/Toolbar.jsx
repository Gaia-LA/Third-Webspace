import React from "react";

export default function Toolbar({ color, setColor, size, setSize, clearBoard, undo }) {
  return (
    <div className="toolbar">
      <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
      <input type="range" min="1" max="20" value={size} onChange={(e) => setSize(e.target.value)} />
      <button onClick={undo}>Undo</button>
      <button onClick={clearBoard}>Clear Board</button>
    </div>
  );
}
