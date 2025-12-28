const { instrument } = require("@socket.io/admin-ui");

// const {
//   saveChat,
//   //   loadChatMates,
// } = require("../controller/chatController");

const ioSocket = (io) => {
  //Connect to websocket
  io.on("connection", (socket) => {
    console.log("Socket Connected -- :D", socket.id);

    //ChatMain - Start - refresh the ChatMain list
    socket.on("watchChat", (user_id) => {
      socket.join("watchChat");
      console.log(`User: ${socket.id} watching chat as ${user_id}`);
    });

    socket.on("refreshChat", (data) => {
      socket.to("watchChat").emit(data.recipient, data.recipient);
    });

    //ChatMain - End

    socket.on("join_room", (roomId) => {
      socket.join(roomId);
      console.log(`User: ${socket.id} joined chat ${roomId}`);
    });

    socket.on("send_message", (data) => {
      saveChat(data);
      socket.to(data.chat_hdr_id).emit(data.chat_hdr_id, [data]);
    });

    socket.on("remove_message", (chatGroupId, chatId) => {
      const removeMsg = chatGroupId + "removeMsg";
      socket.to(chatGroupId).emit(removeMsg, chatId);
    });

    socket.on("is_typing", (data) => {
      const roomIdTyping = data.chat_hdr_id + "showTyping";
      const sendData = { name: data.name, text: data.text };
      socket.to(data.chat_hdr_id).emit(roomIdTyping, sendData);
    });

    socket.on("disconnect", () => {
      console.log("User Disconnected...", socket.id);
    });
  });

  instrument(io, {
    auth: false,
  });
  //websocket end
};

module.exports = ioSocket;
