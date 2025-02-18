const {
    Client,
    GatewayIntentBits,
    Collection,
    Partials,
    REST,
    Routes,
} = require("discord.js");
const fs = require("fs");
const path = require("path");
const config = require("./config.js");
const permissionChecker = require("./utils/permissionChecker");
const http = require("http"); // Import the http module

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
});

client.commands = new Collection();

// Load commands
const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs
    .readdirSync(commandsPath)
    .filter((file) => file.endsWith(".js"));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ("data" in command && "execute" in command) {
        client.commands.set(command.data.name, command);
        console.log(`Loaded command: ${command.data.name}`);
    } else {
        console.log(
            `[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`,
        );
    }
}

// Register slash commands
const rest = new REST({ version: "10" }).setToken(config.token);

(async () => {
    try {
        console.log("Started refreshing application (/) commands.");

        // Get all commands from the commands folder
        const commands = [];
        for (const file of commandFiles) {
            const command = require(path.join(commandsPath, file));
            if ("data" in command && "execute" in command) {
                commands.push(command.data.toJSON());
            }
        }

        // Register commands with Discord
        await rest.put(
            Routes.applicationCommands(config.clientId), // Use your bot's client ID
            { body: commands },
        );

        console.log("Successfully reloaded application (/) commands.");
    } catch (error) {
        console.error("Error registering commands:", error);
    }
})();

// Event handlers
client.once("ready", () => {
    console.log(`Logged in as ${client.user.tag}`);
    console.log(`Loaded ${client.commands.size} commands`);
    console.log("Admin Role ID:", config.adminRoleId);
    console.log("Moderator Role ID:", config.moderatorRoleId);
    console.log("Participant Role ID:", config.participantRoleId);
    console.log("Bot is ready to process commands!");
});

const languageManager = require("./utils/languageManager");

client.on("messageCreate", async (message) => {
    if (message.author.bot || message.content.trim() === "") return;

    try {
        if (message.author.id !== client.user.id) {
            await message.react('🇪🇸');
            await message.react('🇫🇷');
            await message.react('🇩🇪');
            await message.react('🇯🇵');
        }
    } catch (error) {
        console.error("Error adding translation reactions:", error);
    }
});

client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;

    const flagToLang = {
        '🇪🇸': 'es',
        '🇫🇷': 'fr',
        '🇩🇪': 'de',
        '🇯🇵': 'ja'
    };

    const targetLang = flagToLang[reaction.emoji.name];
    if (!targetLang) return;

    try {
        const translated = await languageManager.translateMessage(
            reaction.message.content,
            targetLang
        );

        if (translated && translated.toLowerCase() !== reaction.message.content.toLowerCase()) {
            const channel = reaction.message.channel;
            await channel.send({
                content: `<@${user.id}> Translation to ${targetLang.toUpperCase()}: ${translated}`,
                ephemeral: true
            });
        }
        // Remove user's reaction
        await reaction.users.remove(user);
    } catch (error) {
        console.error("Translation error:", error);
    }
        
        try {
            const translated = await languageManager.translateMessage(
                message.content,
                targetLang
            );

            if (translated && translated.toLowerCase() !== message.content.toLowerCase()) {
                await interaction.reply({
                    content: `Translation to ${targetLang.toUpperCase()}: ${translated}`,
                    ephemeral: true
                });
            } else {
                await interaction.reply({
                    content: 'No translation needed or translation failed.',
                    ephemeral: true
                });
            }
        } catch (error) {
            console.error("Translation error:", error);
            await interaction.reply({
                content: 'Failed to translate the message.',
                ephemeral: true
            });
        }
    }
});

client.on("interactionCreate", async (interaction) => {
    if (!interaction.isCommand() && !interaction.isButton()) return;

    if (interaction.isCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) {
            console.log(
                `No command matching ${interaction.commandName} was found.`,
            );
            return;
        }

        try {
            // Enhanced logging for debugging
            console.log(`Executing command: ${interaction.commandName}`);
            if (interaction.member && interaction.member.roles) {
                console.log(
                    "User roles:",
                    Array.from(
                        interaction.member.roles.cache.map(
                            (r) => `${r.name} (${r.id})`,
                        ),
                    ),
                );
            } else {
                console.log(
                    "No member roles available - command might be from DM",
                );
            }
            console.log("Command options:", interaction.options.data);

            await command.execute(interaction);
            console.log(
                `Successfully executed command: ${interaction.commandName}`,
            );
        } catch (error) {
            console.error(`Error executing ${interaction.commandName}:`);
            console.error(error);
            if (!interaction.deferred && !interaction.replied) {
                await interaction
                    .reply({
                        content: "There was an error executing this command!",
                        ephemeral: true,
                    })
                    .catch(console.error);
            } else {
                await interaction
                    .followUp({
                        content: "There was an error executing this command!",
                        ephemeral: true,
                    })
                    .catch(console.error);
            }
        }
    }

    if (interaction.isButton()) {
        // Check if user has at least participant role for button interactions
        if (!permissionChecker.hasPermission(interaction.member, "hlp")) {
            await interaction.reply({
                content:
                    "You need at least participant role to interact with the lottery.",
                ephemeral: true,
            });
            return;
        }

        const buttonHandler = require("./utils/buttonHandlers");
        try {
            console.log(
                `Processing button interaction: ${interaction.customId}`,
            );
            await buttonHandler.handleButton(interaction);
            console.log(
                `Successfully processed button: ${interaction.customId}`,
            );
        } catch (error) {
            console.error("Button interaction error:", error);
            await interaction
                .reply({
                    content: "There was an error processing this button!",
                    ephemeral: true,
                })
                .catch((error) =>
                    console.error("Failed to send error message:", error),
                );
        }
    }
});

// Error handling for uncaught exceptions
process.on("uncaughtException", (error) => {
    console.error("Uncaught Exception:", error);
});

process.on("unhandledRejection", (reason, promise) => {
    console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

// HTTP server to keep bot alive on hosting platforms like Render
http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Bot is running\n");
})
    .listen(process.env.PORT || 3000, "0.0.0.0")
    .on("error", (error) => {
        console.error("HTTP server error:", error);
    });

client.login(config.token).catch((error) => {
    console.error("Failed to login:", error);
    process.exit(1);
});
