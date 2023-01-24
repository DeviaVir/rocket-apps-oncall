import {
    IHttp,
    IModify,
    IPersistence,
    IRead,
} from '@rocket.chat/apps-engine/definition/accessors';
import {
    ISlashCommand,
    SlashCommandContext,
} from '@rocket.chat/apps-engine/definition/slashcommands';
import { RocketChatAssociationModel, RocketChatAssociationRecord } from '@rocket.chat/apps-engine/definition/metadata';
import { OncallApp } from '../OncallApp';

export class OncallCommand implements ISlashCommand {
    public command = 'oncall';
    public i18nParamsExample = 'oncall get devops | oncall set devops @person';
    public i18nDescription = 'Set or get the current oncall person for a handle.';
    public providesPreview = false;

    constructor(private readonly app: OncallApp) { }

    public async executor(context: SlashCommandContext, read: IRead, modify: IModify, http: IHttp, persistence: IPersistence): Promise<void> {
        let [subcommand, handle, person] = context.getArguments();
        if (handle.startsWith('@')) {
            handle = handle.substring(1);
        }
        const associations: Array<RocketChatAssociationRecord> = [
            new RocketChatAssociationRecord(RocketChatAssociationModel.MISC, 'oncall'),
            new RocketChatAssociationRecord(RocketChatAssociationModel.ROOM, handle),
        ];

        if (!subcommand) {
            throw new Error('Error!');
        }

        switch (subcommand) {
            case 'set':
                if (person.startsWith('@')) {
                    person = person.substring(1);
                }
                await persistence.updateByAssociations(associations, { person: person }, true);
                await this.sendMessage(context, modify, `@${person} is now on call for @${handle}!`);
                break;

            case 'get':
                const persis = read.getPersistenceReader();
                const records: Array<{ person: string }> = (await persis.readByAssociations(associations)) as Array<{ person: string }>;
                if (records.length) {
                    await this.sendMessage(context, modify, `@${records[0].person} is on call for @${handle}!`);
                    break;
                }
                await this.sendMessage(context, modify, `No one is on call for @${handle}!`);
                break;

            default:
                throw new Error('Error!');
        }
    }

    private async sendMessage(context: SlashCommandContext, modify: IModify, message: string): Promise<void> {
        const messageStructure = modify.getCreator().startMessage();
        const sender = context.getSender();
        const room = context.getRoom();

        messageStructure
            .setSender(sender)
            .setRoom(room)
            .setText(message);

        await modify.getCreator().finish(messageStructure);
    }
}
