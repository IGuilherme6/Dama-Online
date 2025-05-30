class CheckersClient {
    constructor() {
        this.ws = null;
        this.board = null;
        this.selectedPiece = null;
        this.playerColor = null;
        this.currentPlayer = 'white';
        this.gameOver = false;
        this.roomId = null;
        this.validMoves = [];
        this.moveCount = 0;

        this.initializeWebSocket();
        this.createBoard();
    }

    initializeWebSocket() {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        this.ws = new WebSocket(`${protocol}//${location.host}`);

        this.ws.onopen = () => this.updateConnectionStatus(true);

        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleMessage(data);
        };

        this.ws.onclose = () => {
            this.updateConnectionStatus(false);
            setTimeout(() => this.initializeWebSocket(), 3000);
        };

        this.ws.onerror = (error) => {
            console.error('Erro WebSocket:', error);
            this.updateConnectionStatus(false);
        };
    }

    updateConnectionStatus(connected) {
        const statusDot = document.getElementById('connectionStatus');
        const statusText = document.getElementById('connectionText');
        statusDot.className = connected ? 'status-dot connected' : 'status-dot disconnected';
        statusText.textContent = connected ? 'Conectado' : 'Desconectado';
    }

    handleMessage(data) {
        if (data.type === 'game_state' && !this.playerColor) {
            if (data.players.white === 'connected' && data.players.black === 'waiting') {
                this.playerColor = 'black';
            } else if (data.players.black === 'connected' && data.players.white === 'waiting') {
                this.playerColor = 'white';
            } else {
                this.playerColor = 'white'; // Primeiro jogador
            }
        }

        switch (data.type) {
            case 'game_state':
                this.updateGameState(data);
                break;
            case 'error':
                this.showMessage(data.message, 'error');
                break;
            case 'game_over':
                this.handleGameOver(data.winner);
                break;
            case 'player_disconnected':
                this.showMessage('Jogador desconectou-se', 'warning');
                break;
        }
    }

    updateGameState(data) {
        this.board = data.board;
        this.currentPlayer = data.currentPlayer;
        this.gameOver = data.gameOver;
        this.renderBoard();
        this.updateGameInfo(data);
        this.updateStats();
    }

    updateGameInfo(data) {
        const whiteStatus = document.getElementById('whiteStatus');
        const blackStatus = document.getElementById('blackStatus');
        const currentTurn = document.getElementById('currentTurn');

        whiteStatus.textContent = data.players.white === 'connected' ? 'Conectado' : 'Aguardando...';
        blackStatus.textContent = data.players.black === 'connected' ? 'Conectado' : 'Aguardando...';

        if (this.gameOver) {
            currentTurn.textContent =
                data.winner === 'draw'
                    ? 'Empate!'
                    : `${data.winner === 'white' ? 'Brancas' : 'Pretas'} venceram!`;
        } else if (data.players.white === 'connected' && data.players.black === 'connected') {
            currentTurn.textContent =
                this.currentPlayer === this.playerColor ? 'Sua vez!' : 
                `Vez das ${this.currentPlayer === 'white' ? 'Brancas' : 'Pretas'}`;
        } else {
            currentTurn.textContent = 'Aguardando jogadores...';
        }
    }

    updateStats() {
        let whitePieces = 0, blackPieces = 0;

        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const piece = this.board[row][col];
                if (piece) {
                    piece.color === 'white' ? whitePieces++ : blackPieces++;
                }
            }
        }

        document.getElementById('whitePieces').textContent = whitePieces;
        document.getElementById('blackPieces').textContent = blackPieces;
        document.getElementById('moveCount').textContent = Math.floor(this.moveCount / 2);
    }

    createBoard() {
        const boardElement = document.getElementById('gameBoard');
        boardElement.innerHTML = '';

        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const square = document.createElement('div');
                square.className = `square ${(row + col) % 2 === 0 ? 'light' : 'dark'}`;
                square.dataset.row = row;
                square.dataset.col = col;
                square.onclick = () => this.handleSquareClick(row, col);
                boardElement.appendChild(square);
            }
        }
    }

    renderBoard() {
        const squares = document.querySelectorAll('.square');

        squares.forEach((square, index) => {
            const row = Math.floor(index / 8);
            const col = index % 8;
            const piece = this.board[row][col];

            square.classList.remove('selected', 'valid-move', 'capture-move');
            square.innerHTML = '';

            if (piece) {
                const pieceElement = document.createElement('div');
                pieceElement.className = `piece ${piece.color} ${piece.isKing ? 'king' : ''}`;
                square.appendChild(pieceElement);
            }
        });

        if (this.selectedPiece) {
            const { row, col } = this.selectedPiece;
            const selectedSquare = document.querySelector(`[data-row="${row}"][data-col="${col}"]`);
            if (selectedSquare) selectedSquare.classList.add('selected');
            this.showValidMoves();
        }
    }

    handleSquareClick(row, col) {
        if (this.gameOver || this.playerColor !== this.currentPlayer) return;

        const piece = this.board[row][col];

        if (piece && piece.color === this.playerColor) {
            this.selectedPiece = { row, col };
            this.renderBoard();
            return;
        }

        if (this.selectedPiece) {
            this.makeMove(this.selectedPiece.row, this.selectedPiece.col, row, col);
            this.selectedPiece = null;
            this.renderBoard();
        }
    }

    showValidMoves() {
        if (!this.selectedPiece) return;

        const { row, col } = this.selectedPiece;
        const piece = this.board[row][col];
        if (!piece || piece.color !== this.playerColor) return;

        for (let toRow = 0; toRow < 8; toRow++) {
            for (let toCol = 0; toCol < 8; toCol++) {
                if (this.isValidMoveClient(row, col, toRow, toCol)) {
                    const square = document.querySelector(`[data-row="${toRow}"][data-col="${toCol}"]`);
                    if (square) {
                        const isCapture = Math.abs(toRow - row) > 1;
                        square.classList.add(isCapture ? 'capture-move' : 'valid-move');
                    }
                }
            }
        }
    }

    isValidMoveClient(fromRow, fromCol, toRow, toCol) {
        if (toRow < 0 || toRow >= 8 || toCol < 0 || toCol >= 8) return false;
        if (this.board[toRow][toCol] !== null) return false;

        const piece = this.board[fromRow][fromCol];
        if (!piece || piece.color !== this.playerColor) return false;

        const rowDiff = toRow - fromRow;
        const colDiff = toCol - fromCol;

        if (Math.abs(rowDiff) !== Math.abs(colDiff)) return false;

        if (!piece.isKing) {
            if (this.playerColor === 'white' && rowDiff > 0) return false;
            if (this.playerColor === 'black' && rowDiff < 0) return false;
        }

        if (Math.abs(rowDiff) === 1) return true;

        if (Math.abs(rowDiff) === 2) {
            const midRow = fromRow + rowDiff / 2;
            const midCol = fromCol + colDiff / 2;
            const midPiece = this.board[midRow][midCol];
            return midPiece && midPiece.color !== this.playerColor;
        }

        if (piece.isKing && Math.abs(rowDiff) > 2) {
            const stepRow = rowDiff > 0 ? 1 : -1;
            const stepCol = colDiff > 0 ? 1 : -1;
            let r = fromRow + stepRow, c = fromCol + stepCol, enemies = 0;

            while (r !== toRow && c !== toCol) {
                const target = this.board[r][c];
                if (target) {
                    if (target.color === this.playerColor) return false;
                    enemies++;
                    if (enemies > 1) return false;
                }
                r += stepRow;
                c += stepCol;
            }

            return true;
        }

        return false;
    }

    makeMove(fromRow, fromCol, toRow, toCol) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.showMessage('Sem conexão com o servidor', 'error');
            return;
        }

        this.ws.send(JSON.stringify({
            type: 'make_move',
            fromRow,
            fromCol,
            toRow,
            toCol
        }));

        this.moveCount++;
    }

    handleGameOver(winner) {
        this.gameOver = true;

        if (winner === 'draw') {
            this.showMessage('Jogo terminou em empate!', 'info');
        } else if (winner === this.playerColor) {
            this.showMessage('Você venceu! 🎉', 'success');
        } else {
            this.showMessage('Você perdeu! 😔', 'error');
        }
    }

    showMessage(message, type = 'info') {
        const el = document.getElementById('statusMessage');
        el.textContent = message;
        el.className = `status-message status-${type}`;
        el.style.display = 'block';

        setTimeout(() => {
            el.style.display = 'none';
        }, 5000);
    }

    joinGame(roomId) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.showMessage('Sem conexão com o servidor', 'error');
            return;
        }

        this.roomId = roomId;
        this.ws.send(JSON.stringify({ type: 'join_game', roomId }));

        document.getElementById('roomSetup').style.display = 'none';
        document.getElementById('gameArea').style.display = 'block';
    }

    restartGame() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        this.ws.send(JSON.stringify({ type: 'restart_game', roomId: this.roomId }));
        this.selectedPiece = null;
        this.gameOver = false;
        this.moveCount = 0;
    }

    leaveGame() {
        document.getElementById('gameArea').style.display = 'none';
        document.getElementById('roomSetup').style.display = 'block';

        this.selectedPiece = null;
        this.playerColor = null;
        this.roomId = null;
        this.gameOver = false;
        this.moveCount = 0;
    }
}

const game = new CheckersClient();

function joinGame() {
    const roomId = document.getElementById('roomIdInput').value.trim();
    if (!roomId) {
        alert('Por favor, digite um ID para a sala');
        return;
    }
    game.joinGame(roomId);
}

function restartGame() {
    game.restartGame();
}

function leaveGame() {
    game.leaveGame();
}

document.getElementById('roomIdInput').addEventListener('keypress', function (e) {
    if (e.key === 'Enter') joinGame();
});
