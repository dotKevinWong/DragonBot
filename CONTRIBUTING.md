## 🤓 Contributing

We welcome all contributions, including bug reports, feature requests, design suggestions and pull requests. Here are some guidelines to follow when contributing to DragonBot.

## 🖥️ Getting Started
You will need to have [Node.js](https://nodejs.org/en/) installed on your machine. You will also need to have setup a [Discord Developer Application](https://discord.com/developers/applications). 

Optionally, you can setup a [Firebase](https://firebase.google.com/) project and a [SendGrid](https://sendgrid.com/) account if you want to test the bot's features that require a database or email delivery.

To get started, follow these steps:

1. Fork the repository
2. Clone the repository to your machine
3. Install the dependencies by running `npm install`

You need to setup environment variables using a [`.env`](.env.example) file in the root directory of the project. The [`.env`](.env.example) file should contain the following variables:
```env
DISCORD_API_TOKEN=
BOT_CLIENT_ID=
EMAIL_API_KEY=
```
You can copy the example [`.env`](.env.example) file and fill in the variables.

Once you have setup the environment variables, you can start the bot. 

4. Run the bot by running `node index.js`
# 
## 🐛 Bug Reports

Please report bugs by [opening an issue](https://github.com/dotKevinWong/drexel.gg/issues/new). Please include the following information in your bug report:

- The steps to reproduce the bug
- The expected behavior
- The actual behavior

## 📝 Feature Requests

Please request features by [opening an issue](https://github.com/dotKevinWong/drexel.gg/issues/new). Please include the following information in your feature request:

- The feature you would like to see
- Why you think this feature is important
- How you imagine this feature to work

### 🛠️ Pull Requests

Please submit pull requests by [opening a pull request](https://github.com/dotKevinWong/drexel.gg/compare). Please include the following information in your pull request:
- The changes you made to the code

## 🏚️ Security Vulnerabilities
Please report security vulnerabilities by submitting a comment in the [Discord Server](https://discord.gg/invite/KCkj4CeMtD) under the [`#security-reports`](https://discord.com/channels/1095523216098861188/1099433676808405084) channel. Please include the following information in your security vulnerability report:
- The vulnerability you found
- How you found the vulnerability or steps to reproduce the vulnerability
- How you think the vulnerability can be fixed (*if you know*)

Please note that once you submit a security report, the message will be automatically hidden in the server. We will update the community about the security vulnerability once we have a fix. 

