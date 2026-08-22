const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let registeredUsers = []; 
let users = []; 
let messagesLog = []; 
let blockedWords = ["porra", "merda", "caralho"]; 
let siteConfig = {
    logoUrl: "https://via.placeholder.com/150x50?text=LOGO+3D",
    bannerUrl: "https://via.placeholder.com/1200x300?text=Banner+Promocional",
    adUrl: "https://via.placeholder.com/728x90?text=Anuncio+aqui"
};

function censorText(text) {
    if (!text) return text;
    let censored = text;
    blockedWords.forEach(word => {
        const regex = new RegExp(word, 'gi');
        const replacement = word.charAt(0) + '*'.repeat(word.length - 2) + word.charAt(word.length - 1);
        censored = censored.replace(regex, replacement);
    });
    return censored;
}

function updateGlobalData() {
    const publicUsersList = registeredUsers.map(regUser => {
        const active = users.find(u => u.nome.toLowerCase() === regUser.nome.toLowerCase());
        return {
            ...regUser,
            id: active ? active.id : null,
            isOnline: !!active && active.status !== 'bloqueado',
            status: active ? active.status : 'offline'
        };
    });

    // Emite para todos os clientes conectados (incluindo painel admin)
    io.emit('update_users_list', publicUsersList);
    io.emit('update_admin_data', { users: publicUsersList, messagesLog });
}

io.on('connection', (socket) => {
    console.log(`Novo usuário conectado: ${socket.id}`);

    socket.on('register_account', (userData) => {
        const existingUser = registeredUsers.find(u => u.nome.toLowerCase() === userData.nome.toLowerCase());
        if (existingUser) {
            socket.emit('register_error', 'Este nome de usuário já está em uso!');
            return;
        }

        const newUser = {
            ...userData,
            foto: 'https://via.placeholder.com/150?text=Sem+Foto',
            status: 'offline'
        };
        
        registeredUsers.push(newUser);
        socket.emit('register_success');
        updateGlobalData();
    });

    socket.on('user_connected_chat', (userData) => {
        if (!userData || !userData.nome) return;

        let activeUser = users.find(u => u.nome.toLowerCase() === userData.nome.toLowerCase());
        if (!activeUser) {
            activeUser = { ...userData, id: socket.id, status: 'ativo' };
            users.push(activeUser);
        } else {
            activeUser.id = socket.id;
            activeUser.status = 'ativo';
        }
        updateGlobalData();
    });

    socket.on('login_account', (data) => {
        const user = registeredUsers.find(u => u.nome.toLowerCase() === data.nome.toLowerCase() && u.senha === data.senha);
        if (!user) {
            socket.emit('login_error', 'Nome de usuário ou senha incorretos!');
            return;
        }

        socket.emit('login_success', user);
        updateGlobalData();
    });

    socket.on('update_photo', (newPhoto) => {
        const activeUser = users.find(u => u.id === socket.id);
        if (activeUser) {
            activeUser.foto = newPhoto;
            const regUser = registeredUsers.find(u => u.nome.toLowerCase() === activeUser.nome.toLowerCase());
            if (regUser) regUser.foto = newPhoto;
            updateGlobalData();
        }
    });

    socket.on('send_private_message', (data) => {
        const sender = users.find(u => u.id === socket.id);
        if (!sender || sender.status === 'bloqueado') return;

        const processedText = censorText(data.text);
        const targetUser = users.find(u => u.id === data.targetSocketId);
        const targetName = targetUser ? targetUser.nome : (data.targetName || 'Desconhecido');

        const msgData = {
            senderName: sender.nome,
            targetName: targetName,
            senderId: socket.id,
            text: processedText,
            image: data.image || null,
            time: new Date().toLocaleTimeString()
        };

        messagesLog.push(msgData);

        if (data.targetSocketId) {
            io.to(data.targetSocketId).emit('receive_private_message', msgData);
        }
        socket.emit('receive_private_message', msgData);
        
        // Garante que o log de mensagens seja enviado ao Admin
        updateGlobalData();
    });

    socket.on('user_logout', (userName) => {
        if (userName) {
            users = users.filter(u => u.nome.toLowerCase() !== userName.toLowerCase());
            updateGlobalData();
        }
    });

    // Disconnect não remove o usuário para garantir que ele fique "Online" permanente
    socket.on('disconnect', () => {
        console.log(`Socket desconectado: ${socket.id}`);
    });

    socket.on('admin_block_user', (userId) => {
        const user = users.find(u => u.id === userId);
        if (user) {
            user.status = 'bloqueado';
            io.to(userId).emit('user_blocked');
            updateGlobalData();
        }
    });

    socket.on('admin_update_config', (newConfig) => {
        siteConfig = { ...siteConfig, ...newConfig };
        io.emit('config_updated', siteConfig);
    });

    socket.on('get_initial_config', () => {
        socket.emit('config_updated', siteConfig);
        updateGlobalData();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});