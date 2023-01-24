import {
    IAppAccessors,
    IConfigurationExtend,
    IEnvironmentRead,
    ILogger,
    IHttp,
    IMessageBuilder,
    IRead,
    IPersistence,
} from '@rocket.chat/apps-engine/definition/accessors';
import { App } from '@rocket.chat/apps-engine/definition/App';
import { IMessage, IPreMessageSentModify } from '@rocket.chat/apps-engine/definition/messages';
import { IAppInfo } from '@rocket.chat/apps-engine/definition/metadata';
import { SettingType } from '@rocket.chat/apps-engine/definition/settings';
import { OncallCommand } from './slashcommands/OncallCommand';
import { RocketChatAssociationModel, RocketChatAssociationRecord } from '@rocket.chat/apps-engine/definition/metadata';

export class OncallApp extends App implements IPreMessageSentModify {
    private matcher: RegExp = /\@/gi;
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

    public async checkPreMessageSentModify(message: IMessage, read: IRead, http: IHttp): Promise<boolean> {
        if (typeof message.text !== 'string') {
            return false;
        }

        const result = message.text.match(this.matcher);

        return result ? result.length !== 0 : false;
    }

    public async executePreMessageSentModify(
        message: IMessage, builder: IMessageBuilder, read: IRead, http: IHttp, persistence: IPersistence): Promise<IMessage> {
        const msg = builder.getMessage();
        if (typeof msg.text !== 'string') {
            return await builder.getMessage();
        }

        // Check if this is a message intended for any of our oncall handles.
        const handles = await read.getEnvironmentReader().getSettings().getById('handles');
        for (let handle of handles.value.split(',')) {
            handle = handle.trim()
            if (!handle.startsWith('@')) {
                handle = `@${handle}`;
            }
            if (msg.text.includes(handle)) {
                const handleWithout = handle.substring(1);
                // Find the oncall person and tag them instead of the handle.
                const associations: Array<RocketChatAssociationRecord> = [
                    new RocketChatAssociationRecord(RocketChatAssociationModel.MISC, 'oncall'),
                    new RocketChatAssociationRecord(RocketChatAssociationModel.ROOM, handleWithout),
                ];
                const persis = read.getPersistenceReader();
                const records: Array<{ person: string }> = (await persis.readByAssociations(associations)) as Array<{ person: string }>;
                if (records.length) {
                    msg.text = msg.text?.replace(handle, `@${records[0].person}`);
                    await builder.setText(msg.text);
                }
            }
        }

        // Check if this is a message that is intended to update our oncall person.
        if (msg.text.includes(`@OncallApp set`)) {
            const parts = msg.text.replace(`@OncallApp set`, '').trim().split(' ');
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
            msg.text = `<OncallApp> @${newPerson} is now oncall for @${handle}`;
            await builder.setText(msg.text);
        }

        // Check if this is a message that is intended to get our oncall person.
        if (msg.text.includes(`@OncallApp get`)) {
            let handle = msg.text.replace(`@OncallApp get`, '').trim();
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
                msg.text = `<OncallApp> @${records[0].person} is oncall for @${handle}`;
                await builder.setText(msg.text);
            } else {
                msg.text = `<OncallApp> No one is oncall for @${handle}`;
                await builder.setText(msg.text);
            }
        }

        return await builder.getMessage();
    }

}
