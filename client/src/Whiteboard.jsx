import React, { useRef, useEffect, useState } from "react";
import { io } from "socket.io-client";
import Toolbar from "./Toolbar";

const socket = io("/");

export default function Whiteboard() {
  const canvasRef = useRef(null);
  const [ctx, setCtx] = useState(null);
  const [drawing, setDrawing] = useState(false);
  const [color, setColor] = useState("#000000");
  const [size, setSize] = useState(2);
  const [actions, setActions] = useState([]);
  const [userId, setUserId] = useState(null);
  const [userActions, setUserActions] = useState([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const context = canvas.getContext("2d");
    setCtx(context);

    socket.on("init", ({ board, userId }) => {
      setActions(board.actions);
      setUserId(userId);
      redraw(context, board.actions);
    });

    socket.on("action", (action) => {
      setActions(prev => [...prev, action]);
      drawAction(context, action);
    });

    socket.on("clear", () => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      setActions([]);
      setUserActions([]);
    });

    window.addEventListener("resize", () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      redraw(context, actions);
    });
  }, [actions]);

  function redraw(context, actionsList) {
    context.clearRect(0, 0, context.canvas.width, context.canvas.height);
    actionsList.forEach(action => drawAction(context, action));
  }

  function drawAction(context, action) {
    if (action.type === "draw") {
      context.strokeStyle = action.color;
      context.lineWidth = action.size;
      context.beginPath();
      context.moveTo(action.start.x, action.start.y);
      context.lineTo(action.end.x, action.end.y);
      context.stroke();
    }
  }

  function handleMouseDown(e) {
    setDrawing(true);
    const rect = canvasRef.current.getBoundingClientRect();
    setUserActions([]);
  }

  function handleMouseMove(e) {
    if (!drawing) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const start = userActions.length ? userActions[userActions.length-1].end : { x: e.clientX-rect.left, y: e.clientY-rect.top };
    const end = { x: e.clientX-rect.left, y: e.clientY-rect.top };
    const action = { type: "draw", start, end, color, size, userId };
    drawAction(ctx, action);
    socket.emit("action", action);
    setActions(prev => [...prev, action]);
    setUserActions(prev => [...prev, action]);
  }

  function handleMouseUp() {
    setDrawing(false);
  }

  function handleUndo() {
    const newActions = actions.filter(a => !(a.userId === userId && userActions.includes(a)));
    setActions(newActions);
    redraw(ctx, newActions);
    setUserActions([]);
  }

  function handleClear() {
    socket.emit("clear");
  }

  return (
    <div className="whiteboard-container">
      <Toolbar color={color} setColor={setColor} size={size} setSize={setSize} clearBoard={handleClear} undo={handleUndo} />
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />
    </div>
  );
}
