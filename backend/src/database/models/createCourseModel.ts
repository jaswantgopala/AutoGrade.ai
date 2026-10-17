import mongoose ,{ Schema, Document } from 'mongoose';

export interface CreateCourse extends Document {
    id: string;
    googleId: string;
    courseWorkId: string;
    courseId: string;
    createdAt: Date;
    updatedAt: Date;
}

const courseWorkSchema = new Schema<CreateCourse>({
    googleId: { ref: 'User', type: String, required: true },
    courseWorkId: { type: String, required: true },
    courseId: { type: String, required: true },

},{
    timestamps: true,
});

export default mongoose.model<CreateCourse>('CreateCourse', courseWorkSchema);