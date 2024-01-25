import {
    IAppAccessors,
    IConfigurationExtend,
    IEnvironmentRead,
    ILogger,
    IHttp,
    IModify,
    IRead,
    IPersistence,
} from '@rocket.chat/apps-engine/definition/accessors';
import { App } from '@rocket.chat/apps-engine/definition/App';
import {IMessage, IPostMessageSent} from '@rocket.chat/apps-engine/definition/messages';
import { IAppInfo } from '@rocket.chat/apps-engine/definition/metadata';
import {IRoom} from '@rocket.chat/apps-engine/definition/rooms/IRoom';
import {IUser} from '@rocket.chat/apps-engine/definition/users/IUser';
import { SettingType } from '@rocket.chat/apps-engine/definition/settings';
import { OncallCommand } from './slashcommands/OncallCommand';
import { RocketChatAssociationModel, RocketChatAssociationRecord } from '@rocket.chat/apps-engine/definition/metadata';

export class OncallApp extends App implements IPostMessageSent {
    constructor(info: IAppInfo, logger: ILogger, accessors: IAppAccessors) {
        super(info, logger, accessors);
        this.getLogger();
    }

    public async initialize(configurationExtend: IConfigurationExtend, environmentRead: IEnvironmentRead): Promise<void> {
        configurationExtend.settings.provideSetting({
            id: 'handles',
            type: SettingType.STRING,
            packageValue: 'oncall',
            required: true,
            public: true,
            i18nLabel: 'Handles to watch out for and tag the person on call for (comma separated)',
        });
        await configurationExtend.slashCommands.provideSlashCommand(new OncallCommand(this));
        await this.extendConfiguration(configurationExtend, environmentRead);
        this.getLogger().log('OncallApp Initialized');
    }

    public async checkPostMessageSent(message: IMessage, read: IRead, http: IHttp): Promise<boolean> {
        if (typeof message.text !== 'string') {
            return false;
        }

        return message.text.includes(`@`);
    }

    public async executePostMessageSent(
        message: IMessage, read: IRead, http: IHttp, persistence: IPersistence, modify: IModify): Promise<void> {
        if (typeof message.text !== 'string') {
            return;
        }

        const author = await read.getUserReader().getAppUser();
        let msg;

        // Check if this is a message intended for any of our oncall handles.
        const handles = await read.getEnvironmentReader().getSettings().getById('handles');
        for (let handle of handles.value.split(',')) {
            handle = handle.trim()
            if (!handle.startsWith('@')) {
                handle = `@${handle}`;
            }
            if (message.text.includes(handle)) {
                const handleWithout = handle.substring(1);
                // Find the oncall person and tag them instead of the handle.
                const associations: Array<RocketChatAssociationRecord> = [
                    new RocketChatAssociationRecord(RocketChatAssociationModel.MISC, 'oncall'),
                    new RocketChatAssociationRecord(RocketChatAssociationModel.ROOM, handleWithout),
                ];
                const persis = read.getPersistenceReader();
                const records: Array<{ person: string }> = (await persis.readByAssociations(associations)) as Array<{ person: string }>;
                if (records.length) {
                    msg = `@${records[0].person} please see message above from @${message.sender.username}!`;
                }
                await this.sendMessage(message.room, msg, author ? author : message.sender, modify)
            }
        }

        // Check if this is a message that is intended to update our oncall person.
        if (message.text.includes(`@OncallApp set`)) {
            const parts = message.text.replace(`@OncallApp set`, '').trim().split(' ');
            let [handle, newPerson] = parts;
            if (newPerson.startsWith('@')) {
                newPerson = newPerson.substring(1);
            }
            if (handle.startsWith('@')) {
                handle = handle.substring(1);
            }
            const associations: Array<RocketChatAssociationRecord> = [
                new RocketChatAssociationRecord(RocketChatAssociationModel.MISC, 'oncall'),
                new RocketChatAssociationRecord(RocketChatAssociationModel.ROOM, handle),
            ];
            await persistence.updateByAssociations(associations, { person: newPerson }, true);
            msg = `<OncallApp> @${newPerson} is now oncall for @${handle}`;
            await this.sendMessage(message.room, msg, author ? author : message.sender, modify)
        }

        // Check if this is a message that is intended to get our oncall person.
        if (message.text.includes(`@OncallApp get`)) {
            let handle = message.text.replace(`@OncallApp get`, '').trim();
            if (handle.startsWith('@')) {
                handle = handle.substring(1);
            }
            const associations: Array<RocketChatAssociationRecord> = [
                new RocketChatAssociationRecord(RocketChatAssociationModel.MISC, 'oncall'),
                new RocketChatAssociationRecord(RocketChatAssociationModel.ROOM, handle),
            ];
            const persis = read.getPersistenceReader();
            const records: Array<{ person: string }> = (await persis.readByAssociations(associations)) as Array<{ person: string }>;
            if (records.length) {
                msg = `<OncallApp> @${records[0].person} is oncall for @${handle}`;
            } else {
                msg = `<OncallApp> No one is oncall for @${handle}`;
            }
            await this.sendMessage(message.room, msg, author ? author : message.sender, modify)
        }

        return;
    }

    private async sendMessage(room: IRoom, textMessage: string, author: IUser, modify: IModify) {
        const messageBuilder = modify.getCreator().startMessage({
            text: textMessage,
        } as IMessage);
        messageBuilder.setRoom(room);
        messageBuilder.setSender(author);
        return modify.getCreator().finish(messageBuilder);
    }

}
