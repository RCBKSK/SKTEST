const {
    Client,
    GatewayIntentBits,
    Collection,
    Partials,
    REST,
    Routes,
    EmbedBuilder,
} = require("discord.js");
const fs = require("fs");
const path = require("path");
const config = require("./config.js");
const permissionChecker = require("./utils/permissionChecker");
const languageManager = require("./utils/languageManager");
const http = require("http");

// Initialize client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [Partials.Channel],
});

client.commands = new Collection();

// Load commands
const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith(".js"));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ("data" in command && "execute" in command) {
        client.commands.set(command.data.name, command);
        console.log(`Loaded command: ${command.data.name}`);
    } else {
        console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
    }
}


client.on('interactionCreate', async interaction => {
    if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('wallet_submit_')) {
            const [, , lotteryId, walletType] = interaction.customId.split('_');
            const walletAddress = interaction.fields.getTextInputValue('wallet_address');
            
            // Get the lottery information
            const lottery = lotteryManager.getLottery(lotteryId);
            if (!lottery) {
                await interaction.reply({ content: 'Could not find lottery information.', ephemeral: true });
                return;
            }

            try {
                // Fetch the creator of the lottery
                const creator = await interaction.client.users.fetch(lottery.createdBy);
                
                const adminEmbed = new EmbedBuilder()
                    .setTitle('🏦 Wallet Address Submitted')
                    .setColor('#00FF00')
                    .setDescription(`A winner has submitted their wallet address!`)
                    .addFields(
                        { name: '👤 User', value: interaction.user.toString() },
                        { name: '🎰 Lottery ID', value: lotteryId },
                        { name: '💼 Wallet Type', value: walletType },
                        { name: '📝 Address', value: walletAddress }
                    )
                    .setTimestamp();

                let notificationSent = false;
                try {
                    await creator.send({ embeds: [adminEmbed] });
                    notificationSent = true;
                } catch (error) {
                    console.error(`Failed to notify lottery creator ${creator.tag}:`, error);
                }

                const replyContent = notificationSent 
                    ? 'Your wallet address has been submitted successfully and the lottery creator has been notified!'
                    : 'Your wallet address has been submitted successfully, but we could not notify the lottery creator. Please contact them directly.';
                
                await interaction.reply({ content: replyContent, ephemeral: true });
            } catch (error) {
                console.error('Failed to process wallet submission:', error);
                await interaction.reply({ content: 'An error occurred while processing your wallet submission.', ephemeral: true });
            }
        }
    }
});

// Register slash commands
const rest = new REST({ version: "10" }).setToken(config.token);

(async () => {
    try {
        console.log("Started refreshing application (/) commands.");
        const commands = [];
        for (const file of commandFiles) {
            const command = require(path.join(commandsPath, file));
            if ("data" in command) commands.push(command.data.toJSON());
        }
        await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
        console.log("Successfully reloaded application (/) commands.");
    } catch (error) {
        console.error("Error registering commands:", error);
    }
})();

// Initialize lottery manager
const { lotteryManager } = require("./utils/lotteryManager");
lotteryManager.setClient(client);

client.once("ready", async () => {
    console.log(`Logged in as ${client.user.tag}`);
    console.log(`Loaded ${client.commands.size} commands`);

    // Restore active lotteries
    try {
        const activeLotteries = await lotteryManager.getAllActiveLotteries();
        console.log(`Restored ${activeLotteries.length} active lotteries`);
    } catch (error) {
        console.error("Restoration error:", error);
    }
    console.log("Bot is ready!");
});

// Interaction handling
client.on("interactionCreate", async (interaction) => {
    if (!interaction.isCommand() && !interaction.isButton()) return;

    if (interaction.isCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) {
            console.log(`No command matching ${interaction.commandName} was found.`);
            return;
        }

        try {
            console.log(`Executing command: ${interaction.commandName}`);
            await command.execute(interaction);
            console.log(`Successfully executed command: ${interaction.commandName}`);
        } catch (error) {
            console.error(`Error executing ${interaction.commandName}:`, error);
            await interaction.reply({
                content: "There was an error executing this command!",
                flags: "EPHEMERAL"
            }).catch(() => {});
        }
    }

    if (interaction.isButton()) {
        if (!permissionChecker.hasPermission(interaction.member, "hlp")) {
            await interaction.reply({
                content: "You need at least participant role to interact with the lottery.",
                flags: "EPHEMERAL"
            });
            return;
        }

        const { handleButton } = require("./utils/buttonHandlers");
        try {
            console.log(`Processing button interaction: ${interaction.customId}`);
            await handleButton(interaction);
            console.log(`Successfully processed button: ${interaction.customId}`);
        } catch (error) {
            console.error("Button interaction error:", error);
            await interaction.reply({
                content: "There was an error processing this button!",
                flags: "EPHEMERAL"
            }).catch(() => {});
        }
    }
});

// Reaction handler for translations
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    
    try {
        // Fetch partial messages/reactions if needed
        if (reaction.partial) await reaction.fetch();
        if (reaction.message.partial) await reaction.message.fetch();

        // Check if reaction is the translation emoji
        if (reaction.emoji.name === '🌐') {
            const targetLang = languageManager.getUserPreference(user.id);
            if (!targetLang) {
                const msg = await reaction.message.channel.send({
                    content: "Please set your preferred language first using /setlanguage",
                    ephemeral: true
                });
                setTimeout(() => msg.delete().catch(() => {}), 10000);
                return;
            }

            const translatedText = await languageManager.translateMessage(reaction.message.content, targetLang);
            
            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('Translation')
                .addFields(
                    { name: 'Original', value: reaction.message.content },
                    { name: `Translation (${targetLang})`, value: translatedText }
                )
                .setFooter({ text: `Requested by ${user.tag}` });

            const translationMsg = await reaction.message.channel.send({ embeds: [embed] });
            setTimeout(() => translationMsg.delete().catch(() => {}), 10000);
        }
    } catch (error) {
        console.error('Translation error:', error);
    }
});

// Error handling
process.on("uncaughtException", error => console.error("Uncaught Exception:", error));
process.on("unhandledRejection", (reason, promise) =>
    console.error("Unhandled Rejection at:", promise, "reason:", reason));

// HTTP server
http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Bot is running\n");
}).listen(process.env.PORT || 3000);

client.login(config.token).catch(error => {
    console.error("Login failed:", error);
    process.exit(1);
});