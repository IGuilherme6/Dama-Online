const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const server = http.createServer((req, res) => {
    let filePath = './public' + (req.url === '/' ? '/index.html' : req.url);
    const extname = String(path.extname(filePath)).toLowerCase();
    const contentTypeMap = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpg',
        '.svg': 'image/svg+xml',
    };
    const contentType = contentTypeMap[extname] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(err.code === 'ENOENT' ? 404 : 500);
            res.end(`Error: ${err.code}`);
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

const wss = new WebSocket.Server({ server });

const rooms = {};

function createInitialBoard() {
    const board = Array.from({ length: 8 }, () => Array(8).fill(null));

    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            if ((row + col) % 2 !== 0) {
                if (row < 3) board[row][col] = { color: 'black', isKing: false };
                if (row > 4) board[row][col] = { color: 'white', isKing: false };
            }
        }
    }
    return board;
}

function getOpponentColor(color) {
    return color === 'white' ? 'black' : 'white';
}

function getRoomState(roomId) {
    const room = rooms[roomId];
    if (!room) return null;

    const players = {
        white: room.white ? 'connected' : 'waiting',
        black: room.black ? 'connected' : 'waiting',
    };

    return {
        type: 'game_state',
        board: room.board,
        currentPlayer: room.currentPlayer,
        gameOver: room.gameOver,
        winner: room.winner || null,
        players,
    };
}

function broadcast(roomId, data) {
    const room = rooms[roomId];
    if (!room) return;

    [room.white, room.black].forEach(client => {
        if (client && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

function handleMove(roomId, fromRow, fromCol, toRow, toCol) {
    const room = rooms[roomId];
    if (!room) return;

    const board = room.board;
    const piece = board[fromRow][fromCol];
    if (!piece || piece.color !== room.currentPlayer) return;

    const rowDiff = toRow - fromRow;
    const colDiff = toCol - fromCol;

    if (Math.abs(rowDiff) !== Math.abs(colDiff)) return;

    const target = board[toRow][toCol];
    if (target) return;

    let valid = false;
    let captured = false;

    if (Math.abs(rowDiff) === 1 && !piece.isKing) {
        valid = (piece.color === 'white' && rowDiff === -1) || (piece.color === 'black' && rowDiff === 1);
    } else if (Math.abs(rowDiff) === 2) {
        const midRow = fromRow + rowDiff / 2;
        const midCol = fromCol + colDiff / 2;
        const midPiece = board[midRow][midCol];
        if (midPiece && midPiece.color !== piece.color) {
            board[midRow][midCol] = null;
            captured = true;
            valid = true;
        }
    } else if (piece.isKing) {
        const stepRow = rowDiff > 0 ? 1 : -1;
        const stepCol = colDiff > 0 ? 1 : -1;
        let r = fromRow + stepRow;
        let c = fromCol + stepCol;
        let enemies = 0;
        while (r !== toRow && c !== toCol) {
            const midPiece = board[r][c];
            if (midPiece) {
                if (midPiece.color === piece.color) return;
                enemies++;
                if (enemies > 1) return;
            }
            r += stepRow;
            c += stepCol;
        }
        if (enemies === 1) captured = true;
        valid = true;
    }

    if (valid) {
        board[toRow][toCol] = piece;
        board[fromRow][fromCol] = null;

        if (!piece.isKing && ((piece.color === 'white' && toRow === 0) || (piece.color === 'black' && toRow === 7))) {
            piece.isKing = true;
        }

        room.currentPlayer = getOpponentColor(room.currentPlayer);

        checkGameOver(roomId);
        broadcast(roomId, getRoomState(roomId));
    }
}

function checkGameOver(roomId) {
    const room = rooms[roomId];
    const board = room.board;
    let whiteCount = 0, blackCount = 0;

    for (const row of board) {
        for (const cell of row) {
            if (cell) {
                cell.color === 'white' ? whiteCount++ : blackCount++;
            }
        }
    }

    if (whiteCount === 0 || blackCount === 0) {
        room.gameOver = true;
        room.winner = whiteCount > 0 ? 'white' : 'black';
        broadcast(roomId, {
            type: 'game_over',
            winner: room.winner,
        });
    }
}

wss.on('connection', (ws) => {
    let currentRoomId = null;
    let assignedColor = null;

    ws.on('message', (message) => {
        let data;
        try {
            data = JSON.parse(message);
        } catch {
            return ws.send(JSON.stringify({ type: 'error', message: 'Dados inválidos' }));
        }

        if (data.type === 'join_game') {
            const roomId = data.roomId;
            currentRoomId = roomId;

            if (!rooms[roomId]) {
                rooms[roomId] = {
                    white: ws,
                    black: null,
                    board: createInitialBoard(),
                    currentPlayer: 'white',
                    gameOver: false,
                    winner: null
                };
                assignedColor = 'white';
            } else {
                const room = rooms[roomId];
                if (!room.white) {
                    room.white = ws;
                    assignedColor = 'white';
                } else if (!room.black) {
                    room.black = ws;
                    assignedColor = 'black';
                } else {
                    return ws.send(JSON.stringify({ type: 'error', message: 'Sala cheia' }));
                }
            }

            broadcast(roomId, getRoomState(roomId));
        }

        if (data.type === 'make_move' && currentRoomId && !rooms[currentRoomId].gameOver) {
            handleMove(currentRoomId, data.fromRow, data.fromCol, data.toRow, data.toCol);
        }

        if (data.type === 'restart_game' && currentRoomId) {
            const room = rooms[currentRoomId];
            room.board = createInitialBoard();
            room.currentPlayer = 'white';
            room.gameOver = false;
            room.winner = null;
            broadcast(currentRoomId, getRoomState(currentRoomId));
        }
    });

    ws.on('close', () => {
        if (!currentRoomId) return;

        const room = rooms[currentRoomId];
        if (!room) return;

        if (room.white === ws) room.white = null;
        if (room.black === ws) room.black = null;

        broadcast(currentRoomId, {
            type: 'player_disconnected',
        });

        // Optionally, delete the room if empty
        if (!room.white && !room.black) {
            delete rooms[currentRoomId];
        }
    });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
