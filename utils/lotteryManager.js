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
            const lottery = {
                id: lotteryId,
                prize: options.prize || 'No prize specified',
                winners: options.winners || 1,
                minParticipants: options.minParticipants || 1,
                terms: options.terms || "Winner must have an active C61 account, or a redraw occurs!",
                startTime: Date.now(),
                endTime: Date.now() + options.duration,
                participants: new Map(),
                maxTicketsPerUser: options.maxTicketsPerUser || 100,
                ticketPrice: options.ticketPrice ?? 0,
                messageId: null,
                channelid: options.channelId,
                guildId: options.guildId,
                isManualDraw: options.isManualDraw ?? false,
                status: 'pending',
                createdBy: options.createdBy,
                totalTickets: 0
            };

            const { data, error } = await supabase
                .from('lotteries')
                .insert([{
                    ...lottery,
                    participants: Object.fromEntries(lottery.participants)
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
        const { error } = await supabase
            .from('lotteries')
            .update({ status })
            .eq('id', lotteryId);
        
        if (!error) {
            const lottery = this.getLottery(lotteryId);
            if (lottery) {
                lottery.status = status;
            }
        }
        return !error;
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

    getAllActiveLotteries() {
        return Array.from(this.lotteries.values())
            .filter(lottery => lottery.status === 'active');
    }

    async drawWinners(lotteryId) {
        const lottery = this.getLottery(lotteryId);
        if (!lottery || lottery.status !== 'active') return null;

        const totalParticipants = lottery.participants.size;
        if (totalParticipants < lottery.minParticipants) {
            lottery.status = 'ended';
            await this.updateLotteryStatus(lotteryId, 'ended');
            return null;
        }

        const winners = new Set();
        const numWinners = Math.min(lottery.winners, lottery.participants.size);
        const ticketArray = [];

        for (const [userId, ticketCount] of lottery.participants) {
            for (let i = 0; i < ticketCount; i++) {
                ticketArray.push(userId);
            }
        }

        while (winners.size < numWinners && ticketArray.length > 0) {
            const randomIndex = Math.floor(Math.random() * ticketArray.length);
            const winner = ticketArray[randomIndex];
            winners.add(winner);
            ticketArray.splice(0, ticketArray.length, ...ticketArray.filter(id => id !== winner));
        }

        lottery.status = 'ended';
        const winnerArray = Array.from(winners);

        const { error } = await supabase
            .from('lotteries')
            .update({
                status: 'ended',
                winners: winnerArray
            })
            .eq('id', lotteryId);

        if (!error) {
            analyticsManager.recordWinners(lotteryId, winnerArray);
            return winnerArray;
        }
        return null;
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