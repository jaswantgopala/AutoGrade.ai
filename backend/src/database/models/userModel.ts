import mongoose ,{ Schema, Document } from 'mongoose';

export interface User extends Document {
    id: string;
    googleId: string;
    email: string;
    fullName: string;
    walletBalanceInr: number;
    googleRefreshToken?: string;
    googleAccessToken?: string;
    jwtSecureCode: string;
    createdAt: Date;
    updatedAt: Date;
}

const userSchema = new Schema<User>({
    googleId: { type: String, required: true , unique: true},
    email: { type: String, required: true, unique: true},
    fullName: { type: String, required: true },
    walletBalanceInr: { type: Number, required: true, default: 0 },
    googleRefreshToken: { type: String },
    googleAccessToken: { type: String },
    jwtSecureCode: { type: String, required: true },
},{
    timestamps: true,
});

export default mongoose.model<User>('User', userSchema);