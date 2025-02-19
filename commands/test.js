
const { SlashCommandBuilder } = require('@discordjs/builders');
const lotteryManager = require('../utils/lotteryManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('test')
        .setDescription('Test Supabase connection'),
    async execute(interaction) {
        await interaction.deferReply();
        const isConnected = await lotteryManager.testConnection();
        
        await interaction.editReply({
            content: isConnected 
                ? '✅ Successfully connected to database!' 
                : '❌ Failed to connect to database. Check your credentials.'
        });
    }
};
