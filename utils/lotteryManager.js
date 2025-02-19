const analyticsManager = require('./analyticsManager');
const supabase = require('./supabaseClient');

class LotteryManager {
    constructor() {
        this.lotteries = new Map();
        this.initializeLotteries();
    }

    async initializeLotteries() {
        const { data, error } = await supabase
            .from('lotteries')
            .select('*')
            .eq('status', 'active');

        if (!error && data) {
            data.forEach(lottery => {
                lottery.participants = new Map(Object.entries(lottery.participants || {}));
                this.lotteries.set(lottery.id, lottery);
            });
        }
    }

    async testDatabaseConnection() {
        try {
            const { data, error } = await supabase
                .from('lotteries')
                .select('*')
                .limit(1);

            if (error) throw error;
            return true;
        } catch (error) {
            console.error('Database connection error:', error);
            return false;
        }
    }

    async createLottery(options) {
        try {
            await options.interaction?.deferReply({ ephemeral: true });
            const lotteryId = Date.now().toString();
            const currentTime = Date.now();
            const lottery = {
                id: lotteryId,
                prize: options.prize || 'No prize specified',
                winners: options.winners || 1,
                minParticipants: options.minParticipants || 1,
                terms: options.terms || "Winner must have an active C61 account, or a redraw occurs!",
                startTime: currentTime,
                endTime: currentTime + options.duration,
                participants: new Map(),
                maxTicketsPerUser: options.maxTicketsPerUser || 100,
                ticketPrice: options.ticketPrice ?? 0,
                messageId: null,
                guildId: options.guildId,
                isManualDraw: options.isManualDraw ?? false,
                status: 'pending',
                createdBy: options.createdBy,
                totalTickets: 0,
                winnerList: [],
                channelid: options.channelId
            };

            const { data, error } = await supabase
                .from('lotteries')
                .insert([{
                    id: lottery.id,
                    prize: lottery.prize,
                    winners: lottery.winners,
                    minParticipants: lottery.minParticipants,
                    terms: lottery.terms,
                    startTime: currentTime,
                    endTime: currentTime + options.duration,
                    participants: Object.fromEntries(lottery.participants),
                    maxTicketsPerUser: lottery.maxTicketsPerUser,
                    ticketPrice: lottery.ticketPrice,
                    messageId: lottery.messageId,
                    guildId: lottery.guildId,
                    isManualDraw: lottery.isManualDraw,
                    status: lottery.status,
                    createdBy: lottery.createdBy,
                    totalTickets: lottery.totalTickets,
                    winnerList: lottery.winnerList || [],
                    channelid: lottery.channelid
                }])
                .select()
                .single();

            if (!error && data) {
                this.lotteries.set(lotteryId, lottery);
                return lottery;
            }

            console.error('Failed to create lottery:', error);
            throw error;
        } catch (error) {
            console.error('Error in createLottery:', error);
            throw error;
        }
    }


    async updateLotteryStatus(lotteryId, status) {
        const lottery = this.getLottery(lotteryId);
        if (!lottery) return false;

        const currentTime = Date.now();
        const updates = {
            status: status,
            endTime: status === 'ended' ? currentTime : lottery.endTime,
            winners: lottery.winners || [],
            winnerList: Array.isArray(lottery.winnerList) ? lottery.winnerList : [],
            totalTickets: lottery.totalTickets
        };

        try {
            const { error } = await supabase
                .from('lotteries')
                .update(updates)
                .eq('id', lotteryId);

            if (error) throw error;

            lottery.status = status;
            if (status === 'ended') {
                lottery.endTime = currentTime;
            }
            this.lotteries.set(lotteryId, lottery);
            console.log(`Successfully updated lottery ${lotteryId} status to ${status}`);
            return true;
        } catch (error) {
            console.error('Error updating lottery status:', error);
            return false;
        }
    }


    async addParticipant(lotteryId, userId, tickets = 1) {
        const lottery = this.getLottery(lotteryId);
        if (!lottery || lottery.status !== 'active') return false;

        const currentTickets = lottery.participants.get(userId) || 0;
        if (currentTickets + tickets > lottery.maxTicketsPerUser) {
            return false;
        }

        lottery.participants.set(userId, currentTickets + tickets);
        lottery.totalTickets += tickets;

        const { error } = await supabase
            .from('lotteries')
            .update({
                participants: Object.fromEntries(lottery.participants),
                totalTickets: lottery.totalTickets
            })
            .eq('id', lotteryId);

        if (!error) {
            analyticsManager.trackParticipation(lotteryId, userId, 'join', tickets);
            return true;
        }
        return false;
    }

    async removeParticipant(lotteryId, userId) {
        const lottery = this.getLottery(lotteryId);
        if (!lottery || lottery.status !== 'active') return false;

        const tickets = lottery.participants.get(userId);
        if (!tickets) return false;

        lottery.totalTickets -= tickets;
        lottery.participants.delete(userId);

        const { error } = await supabase
            .from('lotteries')
            .update({
                participants: Object.fromEntries(lottery.participants),
                totalTickets: lottery.totalTickets
            })
            .eq('id', lotteryId);

        if (!error) {
            analyticsManager.trackParticipation(lotteryId, userId, 'leave', tickets);
            return true;
        }
        return false;
    }

    getLottery(lotteryId) {
        return this.lotteries.get(lotteryId);
    }

    async getAllActiveLotteries() {
        const { data, error } = await supabase
            .from('lotteries')
            .select('*')
            .eq('status', 'active');

        if (error) {
            console.error('Error fetching active lotteries:', error);
            return [];
        }

        // Update local cache
        data.forEach(lottery => {
            lottery.participants = new Map(Object.entries(lottery.participants || {}));
            this.lotteries.set(lottery.id, lottery);
        });

        return data;
    }

    async drawWinners(lotteryId) {
        const lottery = this.getLottery(lotteryId);
        if (!lottery || lottery.status !== 'active') return null;

        const totalParticipants = lottery.participants.size;
        if (totalParticipants < lottery.minParticipants) {
            return [];
        }

        const winners = new Set();
        const numWinners = Math.min(lottery.winners, lottery.participants.size);
        const participantArray = Array.from(lottery.participants.keys());

        // Weighted random selection based on tickets
        const ticketArray = [];
        for (const [userId, tickets] of lottery.participants) {
            for (let i = 0; i < tickets; i++) {
                ticketArray.push(userId);
            }
        }

        while (winners.size < numWinners && ticketArray.length > 0) {
            const randomIndex = Math.floor(Math.random() * ticketArray.length);
            const winner = ticketArray[randomIndex];
            winners.add(winner);
            // Remove all tickets for this winner
            for (let i = ticketArray.length - 1; i >= 0; i--) {
                if (ticketArray[i] === winner) {
                    ticketArray.splice(i, 1);
                }
            }
        }

        lottery.status = 'ended';
        const winnerArray = Array.from(winners);

        const { error } = await supabase
            .from('lotteries')
            .update({
                status: 'ended',
                winners: winnerArray.length,
                winnerList: winnerArray.map(id => parseInt(id, 10)),
                endTime: Date.now(),
                participants: Object.fromEntries(lottery.participants),
                totalTickets: lottery.totalTickets
            })
            .eq('id', lotteryId);

        if (error) {
            console.error('Error updating lottery winners:', error);
            return winnerArray;
        }

        // Update local lottery object
        this.lotteries.set(lotteryId, {
            ...lottery,
            status: 'ended',
            winners: winnerArray,
            winnerList: winnerArray
        });

        analyticsManager.recordWinners(lotteryId, winnerArray);
        return winnerArray;
    }

    async cancelLottery(lotteryId) {
        const lottery = this.getLottery(lotteryId);
        if (!lottery) return false;

        const { error } = await supabase
            .from('lotteries')
            .update({ status: 'cancelled' })
            .eq('id', lotteryId);

        if (!error) {
            lottery.status = 'cancelled';
            return true;
        }
        return false;
    }

    getTimeRemaining(lotteryId) {
        const lottery = this.getLottery(lotteryId);
        if (!lottery) return null;
        return Math.max(0, lottery.endTime - Date.now());
    }

    async testConnection() {
        try {
            const { data, error } = await supabase
                .from('lotteries')
                .select('*')
                .limit(1);

            if (error) {
                console.error('Supabase connection test failed:', error.message);
                return false;
            }

            console.log('Supabase connection successful. Sample data:', data);
            return true;
        } catch (error) {
            console.error('Supabase connection test error:', error);
            return false;
        }
    }

    getParticipantTickets(lotteryId, userId) {
        const lottery = this.getLottery(lotteryId);
        if (!lottery) return 0;
        return lottery.participants.get(userId) || 0;
    }

    getWinningProbability(lotteryId, userId) {
        const lottery = this.getLottery(lotteryId);
        if (!lottery || lottery.totalTickets === 0) return 0;
        const userTickets = lottery.participants.get(userId) || 0;
        return (userTickets / lottery.totalTickets) * 100;
    }
}

module.exports = new LotteryManager();