function urlify(text) {
  var urlRegex = /(https?:\/\/[^\s]+)/g;
  return text.replace(urlRegex, function(url) {
      return '<a href="' + url + '">' + url + '</a>';
  });
}

const $j = jQuery.noConflict();
let messages = null;

// inject chatbot css from met cdn
var cssId = 'metbot-style';
if (!document.getElementById(cssId)) {
    var head  = document.getElementsByTagName('head')[0];
    var link  = document.createElement('link');
    link.id   = cssId;
    link.rel  = 'stylesheet';
    link.type = 'text/css';
    link.href = 'https://met-access.bu.edu/css/metbot/metbot.css';
    link.media = 'all';
    head.appendChild(link);
}

// helper function populate chat window with saved messages
const loadMessages = messages => {
  messages.forEach(msg => {
    let content = '';
    switch(msg.type) {
      case 'text':
        content = `<div class="chatbot-message ${msg.sender}"><p>${urlify(msg.content)}</p></div>`;
        break;
      case 'image':
        content = `<div class="chatbot-message ${msg.sender} image"><img src="${msg.content}" /></div>`;
        break;
      default:
        console.error("Unknown message type!");
    }

    $j(".chatbot-message-window").append(content);
  });
}

// Helper function for resetting the chat window and session
const resetSession = () => {

  // Clear session 
  sessionStorage.clear();

  // Remove chat elements from window
  $j(".chatbot-message-window").children().remove();

  // Reset items in session storage
  messages = [];
  sessionID = uuidv4();
  sessionStorage.setItem("sessionID", sessionID);
  sessionStorage.setItem('opened', JSON.stringify(true));
}

$j(document).ready(() => {
  // check if saved messages exist, if so load them and scroll the window
  messages = sessionStorage.getItem('messages');
  try {
    messages = JSON.parse(messages);
    loadMessages(messages);
    scrollChatWindow();
  } catch (e) {
    // if no saved messages exist, initialize an empty array to store new messages
    messages = [];
  }

  // if sidebar element has no children, hide it
  if ($j(".sidebar > *").length === 0) {
    $j(".sidebar").addClass("hidden");
  }
});

// helper function to generate a valid uuid
const uuidv4 = () => ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));

// scrolls the chat window down so that the latest message is visible
const scrollChatWindow = () => {
  const chat = $j(".chatbot-message-window");
  const height = chat[0].scrollHeight;
  chat.scrollTop(height);
}

// sends a message to dialogflow and displays the response
// be careful of shifting things around, the order of appends matters for the display of messages
const sendMessage = (msg, hidden = false) => {

  // resets entire chat session (i.e. removes contexts of previous conversation)
  if (msg == 'Reset') {
    resetSession();
    msg = 'Hello';
    hidden = true;
}

  // re-enable inputs
  $j(".chatbot-input").prop("disabled", false);
  $j(".chatbot-send").prop("disabled", false);

  // check if the user has a sessionID already, if not generate a new one and save it
  let sessionID = sessionStorage.getItem("sessionID");
  if (!sessionID) {
    sessionID = uuidv4();
    sessionStorage.setItem("sessionID", sessionID);
  }

  if (!hidden) {
    // clear the input box and add the user message to the chat window
    $j(".chatbot-input").val("");
    $j(".chatbot-message-window").append(`<div class="chatbot-message user"><p>${msg}</p></div>`);

    // save the message to session storage so it persists on reloads/page changes
    messages.push({sender: 'user', type: 'text', content: msg});
    sessionStorage.setItem('messages', JSON.stringify(messages));
  }
    
  // add a loading/typing indicator to show that the bot is thinking
  $j(".chatbot-message-window").append(`<div class="chatbot-message bot"><p>...</p></div>`);
  scrollChatWindow();

  // fire a request to the fulfillment server
  $j.ajax({
    type: "POST",
    url: "https://met-avatar.bu.edu/metbot",
    data: JSON.stringify({
      "session": sessionID, // the session id lets dialogflow know which conversation this is
      "queryResult": {
        "queryText": msg
      }
    }),
    contentType: "application/json"
  })
  .done(data => {
    // remove the last message (the typing indicator), then add the bot message and save it
    $j(".chatbot-message-window").children().last().remove();
    $j(".chatbot-message-window").append(`<div class="chatbot-message bot"><p>${urlify(data.fulfillmentText)}</p></div>`);
    messages.push({sender: 'bot', type: 'text', content: data.fulfillmentText});

    // check if the payload has extra data
    const customPayload = data.fulfillmentMessages.find(f => f.message === "payload");
    if (customPayload) {
      console.log(customPayload);
      const { fields } = customPayload.payload;

      // iterate over the fields in the custom payload and handle each accordingly
      Object.keys(fields).forEach(field => {
        switch(field) {
          case 'quickResponse':
            // force user to select a response
            $j(".chatbot-input").prop("disabled", true);
            $j(".chatbot-send").prop("disabled", true);

            const responses = fields[field].listValue.values.map(obj => obj[obj.kind]);
            const id = uuidv4(); // generate an ID so we can reference the quick response container for removal
            let content = '';
            responses.forEach(response => {
              // when a quick response button is clicked, it sends the content as if it was a user message
              // it also deletes the quick response container so it doesn't get clicked again later
              content += `<button onclick="sendMessage('${response}'); $j('#${id}').remove();">${response}</button>`
            });
            $j(".chatbot-message-window").append(`<div id="${id}" class="chatbot-message bot quickResponse">${content}</div>`);
            break;
          case 'image':
            $j(".chatbot-message-window").append(`<div class="chatbot-message bot image"><img src="${fields[field].stringValue}" /></div>`);
            messages.push({sender: 'bot', type: 'image', content: fields[field].stringValue});
            break;
          default:
            console.error("Unknown field!");
        }
      });
    }

    // persist the bot messages
    sessionStorage.setItem('messages', JSON.stringify(messages));
    scrollChatWindow();
  })
  .fail(error => {
    console.error(error);
    const msg = "Sorry, something went wrong! Can you ask that again?";
    $j(".chatbot-message-window").children().last().remove();
    $j(".chatbot-message-window").append(`<div class="chatbot-message bot"><p>${msg}</p></div>`);
    scrollChatWindow();
    messages.push({sender: 'bot', type: 'text', content: msg});
    sessionStorage.setItem('messages', JSON.stringify(messages));
  });
}

// handlers to open/close the chat window using css classes
$j(".chatbot-open").click(event => {
  const firstOpen = !JSON.parse(sessionStorage.getItem('opened'));
  if (firstOpen) {
    sendMessage('Hello', true);
    sessionStorage.setItem('opened', JSON.stringify(true));
  }

  $j('.chatbot-conversation').removeClass("hidden");
  $j(".chatbot-conversation").removeClass("closed");
  $j(".chatbot-open-container").removeClass("open");
  $j(".chatbot-conversation").addClass("open");
  $j(".chatbot-open-container").addClass("closed");
});
$j(".chatbot-close").click(event => {
  $j(".chatbot-conversation").removeClass("open");
  $j(".chatbot-open-container").removeClass("closed");
  $j(".chatbot-conversation").addClass("closed");
  $j(".chatbot-open-container").addClass("open");
});

// Handlers for resetting session
$j(".chatbot-reset").click(event => {
  resetSession();
  sendMessage('Hello', true);
});

// handlers to send a message if a user presses enter or the send button
$j(".chatbot-input").keyup(event => {
  if (event.key == "Enter") {
    sendMessage($j(".chatbot-input").val());
  }
});
$j(".chatbot-send").click(event => sendMessage($j(".chatbot-input").val()));