
const supabase = require('./supabaseClient');
const analyticsManager = require('./analyticsManager');

class LotteryManager {
    constructor() {
        this.lotteries = new Map();
        this.timers = new Map();
        this.client = null;
    }

    setClient(discordClient) {
        this.client = discordClient;
    }

    async createLottery({ prize, winners, minParticipants, duration, createdBy, channelId, guildId, isManualDraw = false, ticketPrice = 0, maxTicketsPerUser = 1, terms = "Winner must have an active C61 account, or a redraw occurs!" }) {
        try {
            const id = Date.now().toString();
            const startTime = Date.now();
            const endTime = startTime + duration;
            
            const lottery = {
                id,
                prize,
                winners: parseInt(winners),
                minParticipants: minParticipants || winners,
                terms,
                startTime,
                endTime,
                participants: {},
                maxTicketsPerUser,
                ticketPrice,
                messageId: null,
                guildId,
                isManualDraw,
                status: 'active',
                createdBy,
                totalTickets: 0,
                winnerList: [],
                channelid: channelId,
                israffle: false
            };

            const { error } = await supabase
                .from('lotteries')
                .insert([lottery]);

            if (error) throw error;

            lottery.participants = new Map(Object.entries(lottery.participants));
            this.lotteries.set(id, lottery);
            
            if (!isManualDraw) {
                this.setTimer(id, duration);
            }

            return lottery;
        } catch (error) {
            console.error('Error creating lottery:', error);
            throw error;
        }
    }

    async drawWinners(lotteryId) {
        const lottery = this.getLottery(lotteryId);
        if (!lottery || lottery.status !== 'active') return [];

        const winners = new Set();
        const ticketPool = [];

        for (const [userId, tickets] of lottery.participants) {
            for (let i = 0; i < tickets; i++) {
                ticketPool.push(userId);
            }
        }

        while (winners.size < lottery.winners && ticketPool.length > 0) {
            const index = Math.floor(Math.random() * ticketPool.length);
            winners.add(ticketPool[index]);
            ticketPool.splice(index, 1);
        }

        const winnerArray = Array.from(winners);
        lottery.winnerList = winnerArray;

        try {
            const { error } = await supabase
                .from('lotteries')
                .update({
                    status: 'ended',
                    winnerList: winnerArray.map(id => ({
                        id: id,
                        username: "Unknown User"
                    }))
                })
                .eq('id', lotteryId);

            if (error) throw error;
            return winnerArray;
        } catch (error) {
            console.error('Error updating winners:', error);
            throw error;
        }
    }

    async updateStatus(lotteryId, status) {
        const lottery = this.getLottery(lotteryId);
        if (!lottery) return;

        try {
            const { error } = await supabase
                .from('lotteries')
                .update({ status })
                .eq('id', lotteryId);

            if (error) throw error;
            lottery.status = status;
        } catch (error) {
            console.error('Error updating status:', error);
            throw error;
        }
    }

    async addParticipant(lotteryId, userId, tickets = 1) {
        const lottery = this.getLottery(lotteryId);
        if (!lottery || lottery.status !== 'active') return false;

        const currentTickets = lottery.participants.get(userId) || 0;
        if (currentTickets + tickets > lottery.maxTicketsPerUser) return false;

        lottery.participants.set(userId, currentTickets + tickets);
        lottery.totalTickets += tickets;

        try {
            const { error } = await supabase
                .from('lotteries')
                .update({
                    participants: Object.fromEntries(lottery.participants),
                    totalTickets: lottery.totalTickets
                })
                .eq('id', lotteryId);

            if (error) throw error;
            analyticsManager.trackParticipation(lotteryId, userId, 'join', tickets);
            return true;
        } catch (error) {
            console.error('Error adding participant:', error);
            return false;
        }
    }

    getLottery(lotteryId) {
        return this.lotteries.get(lotteryId);
    }

    async getAllActiveLotteries() {
        try {
            // Get active lotteries
            const { data: activeLotteries, error: activeError } = await supabase
                .from('lotteries')
                .select('*')
                .eq('status', 'active');

            if (activeError) throw activeError;

            // Get lotteries that ended in the last 10 minutes but might need winner announcement
            const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
            const { data: recentEndedLotteries, error: endedError } = await supabase
                .from('lotteries')
                .select('*')
                .eq('status', 'ended')
                .gt('endTime', tenMinutesAgo);

            if (endedError) throw endedError;

            const now = Date.now();
            const processLottery = async (lottery, isActive) => {
                lottery.participants = new Map(Object.entries(lottery.participants || {}));
                lottery.winnerAnnounced = lottery.winnerAnnounced || false;
                
                if (now > lottery.endTime) {
                    if (lottery.participants.size >= lottery.minParticipants) {
                        if (isActive) {
                            const winners = await this.drawWinners(lottery.id);
                            await this.updateStatus(lottery.id, 'ended');
                        }
                        
                        if (this.client && lottery.channelid && !lottery.winnerAnnounced) {
                            try {
                                const channel = await this.client.channels.fetch(lottery.channelid);
                                if (channel) {
                                    const winnerList = lottery.winnerList || [];
                                    const winnerMentions = winnerList.map(w => 
                                        typeof w === 'string' ? `<@${w}>` : `<@${w.id}>`
                                    ).join(', ');
                                    
                                    await channel.send({
                                        content: `🎉 Lottery ${lottery.id} for ${lottery.prize} has concluded!\n**Winners:** ${winnerMentions}`,
                                        embeds: [messageTemplates.createWinnerEmbed(lottery, winnerList)]
                                    });
                                    
                                    // Update winner announcement status
                                    await supabase
                                        .from('lotteries')
                                        .update({ winnerAnnounced: true })
                                        .eq('id', lottery.id);
                                        
                                    lottery.winnerAnnounced = true;
                                }
                            } catch (err) {
                                console.error('Error sending winner message:', err);
                            }
                        }
                    } else if (isActive) {
                        await this.updateStatus(lottery.id, 'ended');
                        if (this.client && lottery.channelid) {
                            try {
                                const channel = await this.client.channels.fetch(lottery.channelid);
                                if (channel) {
                                    await channel.send(`⚠️ Lottery ${lottery.id} for ${lottery.prize} has ended without winners due to insufficient participants (${lottery.participants.size}/${lottery.minParticipants} required).`);
                                }
                            } catch (err) {
                                console.error('Error sending end message:', err);
                            }
                        }
                    }
                    return null;
                }

                if (isActive) {
                    this.lotteries.set(lottery.id, lottery);
                    if (!lottery.isManualDraw) {
                        const remainingTime = lottery.endTime - now;
                        this.setTimer(lottery.id, remainingTime);
                    }
                }
                return isActive ? lottery : null;
            };

            const activePromises = activeLotteries.map(lottery => processLottery(lottery, true));
            const endedPromises = recentEndedLotteries.map(lottery => processLottery(lottery, false));

            const results = await Promise.all([...activePromises, ...endedPromises]);
            return results.filter(lottery => lottery !== null);
        } catch (error) {
            console.error('Error fetching lotteries:', error);
            return [];
        }
    }

    setTimer(lotteryId, duration) {
        if (this.timers.has(lotteryId)) {
            clearTimeout(this.timers.get(lotteryId));
        }
        const timer = setTimeout(() => this.endLottery(lotteryId), duration);
        this.timers.set(lotteryId, timer);
    }

    async endLottery(lotteryId) {
        const lottery = this.getLottery(lotteryId);
        if (!lottery || lottery.status !== 'active') return;

        try {
            if (lottery.participants.size < lottery.minParticipants) {
                await this.updateStatus(lotteryId, 'ended');
                return [];
            }

            const winners = await this.drawWinners(lotteryId);
            await this.updateStatus(lotteryId, 'ended');
            return winners;
        } catch (error) {
            console.error('Error ending lottery:', error);
            await this.updateStatus(lotteryId, 'ended');
            throw error;
        }
    }
}

module.exports = new LotteryManager();
